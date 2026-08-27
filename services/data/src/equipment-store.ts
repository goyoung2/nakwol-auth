import { newDataId, type CreateEquipmentInput, type EquipmentTraitInput, type PatchEquipmentInput } from './domain.ts';
import type { DataEnv } from './types.ts';

type EquipmentType = 'weapon'|'mount';
type EvidenceState = 'canonical'|'observed'|'unresolved';
type TraitKind = 'skill'|'effect';

type EquipmentRow = {
  id:string;
  template_id:string;
  template_name:string;
  type:EquipmentType;
  nickname:string|null;
  locked:number;
  favorite:number;
  created_at:number;
  updated_at:number;
};

type TemplateRow = { id:string; name:string; type:EquipmentType; };
type TraitRegistryRow = {
  id:string;
  kind:TraitKind|null;
  name:string;
  description:string|null;
  evidence_state:EvidenceState;
  enabled:number;
};
type TraitJoinRow = {
  equipment_id:string;
  slot:number;
  trait_id:string;
  kind:TraitKind|null;
  name:string;
  description:string|null;
};

export type EquipmentTraitData = {
  slot:number;
  trait_id:string;
  kind:TraitKind|null;
  name:string;
  description:string|null;
};

export type EquipmentData = {
  id:string;
  template_id:string;
  template_name:string;
  type:EquipmentType;
  nickname:string|null;
  locked:boolean;
  favorite:boolean;
  created_at:number;
  updated_at:number;
  traits:EquipmentTraitData[];
};

type TraitValidation =
  | { kind:'ok'; rows:Array<{ input:EquipmentTraitInput; trait:TraitRegistryRow }> }
  | { kind:'trait_not_found' }
  | { kind:'trait_unverified' }
  | { kind:'trait_unverified_for_type' };

async function ownsAccount(env:Pick<DataEnv,'DB'>, userId:string, accountId:string):Promise<boolean> {
  return Boolean(await env.DB.prepare('SELECT 1 AS ok FROM game_accounts WHERE id = ? AND user_id = ? LIMIT 1').bind(accountId,userId).first());
}

async function getTemplate(env:Pick<DataEnv,'DB'>, templateId:string):Promise<TemplateRow|null> {
  return env.DB.prepare(`SELECT id,name,type FROM game_equipment_templates WHERE id = ? AND enabled = 1 AND type IN ('weapon','mount') LIMIT 1`).bind(templateId).first<TemplateRow>();
}

async function getOwnedEquipment(env:Pick<DataEnv,'DB'>, userId:string, accountId:string, equipmentId:string):Promise<EquipmentRow|null> {
  return env.DB.prepare(`SELECT ue.id,ue.template_id,et.name AS template_name,et.type,ue.nickname,ue.locked,ue.favorite,ue.created_at,ue.updated_at
    FROM user_equipment ue
    JOIN game_equipment_templates et ON et.id = ue.template_id
    JOIN game_accounts ga ON ga.id = ue.account_id
    WHERE ue.id = ? AND ue.account_id = ? AND ga.user_id = ? LIMIT 1`)
    .bind(equipmentId,accountId,userId).first<EquipmentRow>();
}

async function validateTraits(env:Pick<DataEnv,'DB'>, traits:EquipmentTraitInput[], type:EquipmentType):Promise<TraitValidation> {
  const rows:Array<{ input:EquipmentTraitInput; trait:TraitRegistryRow }>=[];
  for (const input of traits) {
    const trait = await env.DB.prepare(`SELECT id,kind,name,description,evidence_state,enabled FROM game_equipment_traits WHERE id = ? LIMIT 1`)
      .bind(input.traitId).first<TraitRegistryRow>();
    if (!trait || trait.enabled !== 1) return { kind:'trait_not_found' };
    if (trait.evidence_state !== 'canonical') return { kind:'trait_unverified' };
    const applicability = await env.DB.prepare(`SELECT evidence_state FROM game_equipment_trait_applicability WHERE trait_id = ? AND equipment_type = ? LIMIT 1`)
      .bind(input.traitId,type).first<{evidence_state:EvidenceState}>();
    if (!applicability || applicability.evidence_state !== 'canonical') return { kind:'trait_unverified_for_type' };
    rows.push({ input, trait });
  }
  return { kind:'ok', rows };
}

function toTraitData(row:{ input:EquipmentTraitInput; trait:TraitRegistryRow }):EquipmentTraitData {
  return { slot:row.input.slot, trait_id:row.trait.id, kind:row.trait.kind, name:row.trait.name, description:row.trait.description };
}

function toEquipmentData(row:EquipmentRow, traits:EquipmentTraitData[]):EquipmentData {
  return {
    id:row.id,
    template_id:row.template_id,
    template_name:row.template_name,
    type:row.type,
    nickname:row.nickname,
    locked:Boolean(row.locked),
    favorite:Boolean(row.favorite),
    created_at:row.created_at,
    updated_at:row.updated_at,
    traits,
  };
}

async function loadTraitsForEquipmentIds(env:Pick<DataEnv,'DB'>, equipmentIds:string[]):Promise<Map<string,EquipmentTraitData[]>> {
  const grouped=new Map<string,EquipmentTraitData[]>();
  if (equipmentIds.length===0) return grouped;
  const placeholders=equipmentIds.map(()=>'?').join(',');
  const result=await env.DB.prepare(`SELECT ut.equipment_id,ut.slot,gt.id AS trait_id,gt.kind,gt.name,gt.description
    FROM user_equipment_traits ut
    JOIN game_equipment_traits gt ON gt.id = ut.trait_id
    WHERE ut.equipment_id IN (${placeholders})
    ORDER BY ut.equipment_id,ut.slot`).bind(...equipmentIds).all<TraitJoinRow>();
  for (const row of result.results || []) {
    const items=grouped.get(row.equipment_id)??[];
    items.push({ slot:row.slot,trait_id:row.trait_id,kind:row.kind,name:row.name,description:row.description });
    grouped.set(row.equipment_id,items);
  }
  return grouped;
}

export async function listEquipmentV08(env:Pick<DataEnv,'DB'>, userId:string, accountId:string):Promise<EquipmentData[]|null> {
  if (!await ownsAccount(env,userId,accountId)) return null;
  const result=await env.DB.prepare(`SELECT ue.id,ue.template_id,et.name AS template_name,et.type,ue.nickname,ue.locked,ue.favorite,ue.created_at,ue.updated_at
    FROM user_equipment ue JOIN game_equipment_templates et ON et.id = ue.template_id
    WHERE ue.account_id = ? ORDER BY ue.created_at,ue.id`).bind(accountId).all<EquipmentRow>();
  const rows=result.results||[];
  const traits=await loadTraitsForEquipmentIds(env,rows.map((row)=>row.id));
  return rows.map((row)=>toEquipmentData(row,traits.get(row.id)??[]));
}

export type CreateEquipmentV08Result =
  | { kind:'account_not_found' }
  | { kind:'template_not_found' }
  | { kind:'trait_not_found' }
  | { kind:'trait_unverified' }
  | { kind:'trait_unverified_for_type' }
  | { kind:'ok'; data:EquipmentData };

export async function createEquipmentV08(env:Pick<DataEnv,'DB'>, userId:string, accountId:string, input:CreateEquipmentInput):Promise<CreateEquipmentV08Result> {
  if (!await ownsAccount(env,userId,accountId)) return { kind:'account_not_found' };
  const template=await getTemplate(env,input.templateId);
  if (!template) return { kind:'template_not_found' };
  const validated=await validateTraits(env,input.traits,template.type);
  if (validated.kind!=='ok') return validated;

  const id=newDataId('eqp');
  const now=Date.now();
  const statements:any[]=[env.DB.prepare(`INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id,accountId,input.templateId,input.nickname,input.locked?1:0,input.favorite?1:0,now,now)];
  for (const row of validated.rows) statements.push(env.DB.prepare(`INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES (?,?,?)`).bind(id,row.input.slot,row.input.traitId));
  await env.DB.batch(statements);

  return { kind:'ok', data:{
    id,template_id:template.id,template_name:template.name,type:template.type,nickname:input.nickname,
    locked:input.locked,favorite:input.favorite,created_at:now,updated_at:now,
    traits:validated.rows.map(toTraitData),
  } };
}

export type PatchEquipmentV08Result =
  | { kind:'equipment_not_found' }
  | { kind:'trait_not_found' }
  | { kind:'trait_unverified' }
  | { kind:'trait_unverified_for_type' }
  | { kind:'ok'; data:EquipmentData };

export async function patchEquipmentV08(env:Pick<DataEnv,'DB'>, userId:string, accountId:string, equipmentId:string, input:PatchEquipmentInput):Promise<PatchEquipmentV08Result> {
  const current=await getOwnedEquipment(env,userId,accountId,equipmentId);
  if (!current) return { kind:'equipment_not_found' };
  const validated=input.hasTraits?await validateTraits(env,input.traits,current.type):null;
  if (validated && validated.kind!=='ok') return validated;

  const nickname=input.hasNickname?input.nickname:current.nickname;
  const locked=input.hasLocked?input.locked:Boolean(current.locked);
  const favorite=input.hasFavorite?input.favorite:Boolean(current.favorite);
  const now=Date.now();
  const statements:any[]=[env.DB.prepare(`UPDATE user_equipment SET nickname = ?, locked = ?, favorite = ?, updated_at = ? WHERE id = ? AND account_id = ?`)
    .bind(nickname,locked?1:0,favorite?1:0,now,equipmentId,accountId)];
  if (input.hasTraits) {
    statements.push(env.DB.prepare(`DELETE FROM user_equipment_traits WHERE equipment_id = ?`).bind(equipmentId));
    for (const row of validated!.rows) statements.push(env.DB.prepare(`INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES (?,?,?)`).bind(equipmentId,row.input.slot,row.input.traitId));
  }
  await env.DB.batch(statements);

  let traits:EquipmentTraitData[];
  if (input.hasTraits) traits=validated!.rows.map(toTraitData);
  else traits=(await loadTraitsForEquipmentIds(env,[equipmentId])).get(equipmentId)??[];
  return { kind:'ok', data:{
    id:current.id,template_id:current.template_id,template_name:current.template_name,type:current.type,
    nickname,locked,favorite,created_at:current.created_at,updated_at:now,traits,
  } };
}
