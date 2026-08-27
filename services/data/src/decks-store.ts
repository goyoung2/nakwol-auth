import { isCanonicalOwnableTacticMetadata, newDataId } from './domain.ts';
import type { CreateDeckInput, PatchDeckInput, ReplaceCompositionInput } from './decks-domain.ts';
import type { DataEnv } from './types.ts';

type DeckRow = {
  id:string;
  name:string;
  season_id:string|null;
  status:'active'|'candidate'|'research'|'archived';
  visibility:'private'|'alliance'|'public';
  note:string|null;
  is_primary:number;
  created_at:number;
  updated_at:number;
};

type DeckListRow = DeckRow & {
  general_count:number;
  tactic_count:number;
  equipment_count:number;
};

export type DeckData = Omit<DeckRow,'is_primary'> & {is_primary:boolean};
export type DeckListData = DeckData & {general_count:number;tactic_count:number;equipment_count:number};
export type DeckEquipmentData = {
  id:string;
  template_id:string;
  template_name:string;
  type:'weapon'|'mount';
  nickname:string|null;
  locked:boolean;
  favorite:boolean;
};
export type DeckTacticData = {slot:number;tactic_id:string;tactic_name:string};
export type DeckGeneralData = {
  position:number;
  general_id:string;
  general_name:string;
  weapon:DeckEquipmentData|null;
  mount:DeckEquipmentData|null;
  tactics:DeckTacticData[];
};

function mapDeck(row:DeckRow):DeckData { return { ...row, is_primary:Boolean(row.is_primary) }; }
function mapDeckList(row:DeckListRow):DeckListData { return { ...row, is_primary:Boolean(row.is_primary) }; }

async function ownsGameAccount(env:Pick<DataEnv,'DB'>,userId:string,accountId:string):Promise<boolean> {
  const row=await env.DB.prepare(`SELECT 1 AS owned FROM game_accounts WHERE id = ? AND user_id = ? LIMIT 1`).bind(accountId,userId).first<{owned:number}>();
  return Boolean(row?.owned);
}

async function seasonExists(env:Pick<DataEnv,'DB'>,seasonId:string|null):Promise<boolean> {
  if(seasonId===null) return true;
  const row=await env.DB.prepare(`SELECT 1 AS found FROM game_seasons WHERE id = ? AND enabled = 1 LIMIT 1`).bind(seasonId).first<{found:number}>();
  return Boolean(row?.found);
}

async function getOwnedDeckRow(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<DeckRow|null> {
  return env.DB.prepare(`SELECT d.id,d.name,d.season_id,d.status,d.visibility,d.note,d.is_primary,d.created_at,d.updated_at
    FROM decks d
    JOIN game_accounts ga ON ga.id = d.account_id
    WHERE d.id = ? AND d.account_id = ? AND ga.user_id = ?
    LIMIT 1`).bind(deckId,accountId,userId).first<DeckRow>();
}

export async function listDecks(env:Pick<DataEnv,'DB'>,userId:string,accountId:string):Promise<DeckListData[]|null> {
  if(!await ownsGameAccount(env,userId,accountId)) return null;
  const result=await env.DB.prepare(`SELECT d.id,d.name,d.season_id,d.status,d.visibility,d.note,d.is_primary,d.created_at,d.updated_at,
      (SELECT COUNT(*) FROM deck_general_slots gs WHERE gs.deck_id=d.id) AS general_count,
      (SELECT COUNT(*) FROM deck_tactic_slots ts WHERE ts.deck_id=d.id) AS tactic_count,
      (SELECT COUNT(weapon_instance_id)+COUNT(mount_instance_id) FROM deck_general_slots es WHERE es.deck_id=d.id) AS equipment_count
    FROM decks d
    JOIN game_accounts ga ON ga.id=d.account_id
    WHERE d.account_id=? AND ga.user_id=?
    ORDER BY d.is_primary DESC,d.updated_at DESC,d.id`).bind(accountId,userId).all<DeckListRow>();
  return result.results.map(mapDeckList);
}

export type CreateDeckResult = {kind:'account_not_found'}|{kind:'season_not_found'}|{kind:'ok';data:DeckData};
export async function createDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,input:CreateDeckInput):Promise<CreateDeckResult> {
  if(!await ownsGameAccount(env,userId,accountId)) return {kind:'account_not_found'};
  if(!await seasonExists(env,input.seasonId)) return {kind:'season_not_found'};
  const id=newDataId('dek'); const now=Date.now();
  await env.DB.prepare(`INSERT INTO decks(id,account_id,name,season_id,status,visibility,note,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,accountId,input.name,input.seasonId,input.status,input.visibility,input.note,input.isPrimary?1:0,now,now).run();
  return {kind:'ok',data:{id,name:input.name,season_id:input.seasonId,status:input.status,visibility:input.visibility,note:input.note,is_primary:input.isPrimary,created_at:now,updated_at:now}};
}

type GeneralSlotRow = {
  position:number; general_id:string; general_name:string;
  weapon_id:string|null; weapon_template_id:string|null; weapon_template_name:string|null; weapon_type:'weapon'|'mount'|null; weapon_nickname:string|null; weapon_locked:number|null; weapon_favorite:number|null;
  mount_id:string|null; mount_template_id:string|null; mount_template_name:string|null; mount_type:'weapon'|'mount'|null; mount_nickname:string|null; mount_locked:number|null; mount_favorite:number|null;
};
type TacticSlotRow = {general_position:number;slot:number;tactic_id:string;tactic_name:string};

function mapSlotEquipment(row:GeneralSlotRow,prefix:'weapon'|'mount'):DeckEquipmentData|null {
  const id=prefix==='weapon'?row.weapon_id:row.mount_id;
  const templateId=prefix==='weapon'?row.weapon_template_id:row.mount_template_id;
  const templateName=prefix==='weapon'?row.weapon_template_name:row.mount_template_name;
  const type=prefix==='weapon'?row.weapon_type:row.mount_type;
  if(!id||!templateId||!templateName||!type) return null;
  return {
    id,template_id:templateId,template_name:templateName,type,
    nickname:prefix==='weapon'?row.weapon_nickname:row.mount_nickname,
    locked:Boolean(prefix==='weapon'?row.weapon_locked:row.mount_locked),
    favorite:Boolean(prefix==='weapon'?row.weapon_favorite:row.mount_favorite),
  };
}

export async function getDeckComposition(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<DeckGeneralData[]|null> {
  if(!await getOwnedDeckRow(env,userId,accountId,deckId)) return null;
  const generals=await env.DB.prepare(`SELECT gs.position,gs.general_id,g.name AS general_name,
      w.id AS weapon_id,w.template_id AS weapon_template_id,wt.name AS weapon_template_name,wt.type AS weapon_type,w.nickname AS weapon_nickname,w.locked AS weapon_locked,w.favorite AS weapon_favorite,
      m.id AS mount_id,m.template_id AS mount_template_id,mt.name AS mount_template_name,mt.type AS mount_type,m.nickname AS mount_nickname,m.locked AS mount_locked,m.favorite AS mount_favorite
    FROM deck_general_slots gs
    JOIN game_generals g ON g.id=gs.general_id
    LEFT JOIN user_equipment w ON w.id=gs.weapon_instance_id AND w.account_id=?
    LEFT JOIN game_equipment_templates wt ON wt.id=w.template_id
    LEFT JOIN user_equipment m ON m.id=gs.mount_instance_id AND m.account_id=?
    LEFT JOIN game_equipment_templates mt ON mt.id=m.template_id
    WHERE gs.deck_id=? ORDER BY gs.position`).bind(accountId,accountId,deckId).all<GeneralSlotRow>();
  const tactics=await env.DB.prepare(`SELECT ts.general_position,ts.slot,ts.tactic_id,t.name AS tactic_name
    FROM deck_tactic_slots ts JOIN game_tactics t ON t.id=ts.tactic_id
    WHERE ts.deck_id=? ORDER BY ts.general_position,ts.slot`).bind(deckId).all<TacticSlotRow>();
  const tacticsByPosition=new Map<number,DeckTacticData[]>();
  for(const row of tactics.results){
    const list=tacticsByPosition.get(row.general_position)??[];
    list.push({slot:row.slot,tactic_id:row.tactic_id,tactic_name:row.tactic_name});
    tacticsByPosition.set(row.general_position,list);
  }
  return generals.results.map((row)=>({
    position:row.position,general_id:row.general_id,general_name:row.general_name,
    weapon:mapSlotEquipment(row,'weapon'),mount:mapSlotEquipment(row,'mount'),
    tactics:tacticsByPosition.get(row.position)??[],
  }));
}

export type GetDeckResult = {kind:'deck_not_found'}|{kind:'ok';data:DeckData & {generals:DeckGeneralData[]}};
export async function getDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<GetDeckResult> {
  const row=await getOwnedDeckRow(env,userId,accountId,deckId);
  if(!row) return {kind:'deck_not_found'};
  const generals=await getDeckComposition(env,userId,accountId,deckId)??[];
  return {kind:'ok',data:{...mapDeck(row),generals}};
}

export type PatchDeckResult = {kind:'deck_not_found'}|{kind:'season_not_found'}|{kind:'ok';data:DeckData};
export async function patchDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string,input:PatchDeckInput):Promise<PatchDeckResult> {
  const current=await getOwnedDeckRow(env,userId,accountId,deckId);
  if(!current) return {kind:'deck_not_found'};
  const name=input.hasName?input.name:current.name;
  const seasonId=input.hasSeasonId?input.seasonId:current.season_id;
  const status=input.hasStatus?input.status:current.status;
  const visibility=input.hasVisibility?input.visibility:current.visibility;
  const note=input.hasNote?input.note:current.note;
  const isPrimary=input.hasIsPrimary?input.isPrimary:Boolean(current.is_primary);
  if(input.hasSeasonId&&!await seasonExists(env,seasonId)) return {kind:'season_not_found'};
  const now=Date.now();
  await env.DB.prepare(`UPDATE decks SET name=?,season_id=?,status=?,visibility=?,note=?,is_primary=?,updated_at=? WHERE id=? AND account_id=?`)
    .bind(name,seasonId,status,visibility,note,isPrimary?1:0,now,deckId,accountId).run();
  return {kind:'ok',data:{id:current.id,name,season_id:seasonId,status,visibility,note,is_primary:isPrimary,created_at:current.created_at,updated_at:now}};
}

export type DeleteDeckResult = {kind:'deck_not_found'}|{kind:'ok';data:{deleted:true;id:string}};
export async function deleteDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<DeleteDeckResult> {
  if(!await getOwnedDeckRow(env,userId,accountId,deckId)) return {kind:'deck_not_found'};
  await env.DB.prepare(`DELETE FROM decks WHERE id=? AND account_id=?`).bind(deckId,accountId).run();
  return {kind:'ok',data:{deleted:true,id:deckId}};
}

type TacticRegistryRow={id:string;name:string;metadata_json:string};
async function canonicalTactic(env:Pick<DataEnv,'DB'>,tacticId:string):Promise<{id:string;name:string}|null> {
  const tactic=await env.DB.prepare(`SELECT id,name,metadata_json FROM game_tactics WHERE id=? AND enabled=1 LIMIT 1`).bind(tacticId).first<TacticRegistryRow>();
  if(!tactic) return null;
  let metadata:Record<string,unknown>; try{metadata=JSON.parse(tactic.metadata_json||'{}') as Record<string,unknown>;}catch{return null;}
  if(!isCanonicalOwnableTacticMetadata(metadata)) return null;
  const unique=await env.DB.prepare(`SELECT 1 AS matched FROM game_generals WHERE unique_tactic_id=? LIMIT 1`).bind(tacticId).first<{matched:number}>();
  return unique?null:{id:tactic.id,name:tactic.name};
}

type EquipmentValidationRow={id:string;type:'weapon'|'mount'};
async function ownedEquipment(env:Pick<DataEnv,'DB'>,accountId:string,equipmentId:string):Promise<EquipmentValidationRow|null> {
  return env.DB.prepare(`SELECT ue.id,et.type FROM user_equipment ue JOIN game_equipment_templates et ON et.id=ue.template_id WHERE ue.id=? AND ue.account_id=? LIMIT 1`)
    .bind(equipmentId,accountId).first<EquipmentValidationRow>();
}

export type ReplaceCompositionResult =
  | {kind:'deck_not_found'}|{kind:'general_not_found'}|{kind:'tactic_not_found'}|{kind:'equipment_not_found'}|{kind:'equipment_type_mismatch'}
  | {kind:'ok';data:{deck_id:string;generals:DeckGeneralData[];updated_at:number}};

export async function replaceDeckComposition(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string,input:ReplaceCompositionInput):Promise<ReplaceCompositionResult> {
  if(!await getOwnedDeckRow(env,userId,accountId,deckId)) return {kind:'deck_not_found'};
  for(const general of input.generals){
    const found=await env.DB.prepare(`SELECT id FROM game_generals WHERE id=? AND enabled=1 LIMIT 1`).bind(general.generalId).first<{id:string}>();
    if(!found) return {kind:'general_not_found'};
    for(const tactic of general.tactics) if(!await canonicalTactic(env,tactic.tacticId)) return {kind:'tactic_not_found'};
    if(general.weaponInstanceId){
      const equipment=await ownedEquipment(env,accountId,general.weaponInstanceId);
      if(!equipment) return {kind:'equipment_not_found'};
      if(equipment.type!=='weapon') return {kind:'equipment_type_mismatch'};
    }
    if(general.mountInstanceId){
      const equipment=await ownedEquipment(env,accountId,general.mountInstanceId);
      if(!equipment) return {kind:'equipment_not_found'};
      if(equipment.type!=='mount') return {kind:'equipment_type_mismatch'};
    }
  }
  const now=Date.now();
  const statements:any[]=[
    env.DB.prepare(`DELETE FROM deck_tactic_slots WHERE deck_id=?`).bind(deckId),
    env.DB.prepare(`DELETE FROM deck_general_slots WHERE deck_id=?`).bind(deckId),
  ];
  for(const general of input.generals){
    statements.push(env.DB.prepare(`INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES (?,?,?,?,?)`)
      .bind(deckId,general.position,general.generalId,general.weaponInstanceId,general.mountInstanceId));
    for(const tactic of general.tactics) statements.push(env.DB.prepare(`INSERT INTO deck_tactic_slots(deck_id,general_position,slot,tactic_id) VALUES (?,?,?,?)`)
      .bind(deckId,general.position,tactic.slot,tactic.tacticId));
  }
  statements.push(env.DB.prepare(`UPDATE decks SET updated_at=? WHERE id=? AND account_id=?`).bind(now,deckId,accountId));
  await env.DB.batch(statements);
  return {kind:'ok',data:{deck_id:deckId,generals:await getDeckComposition(env,userId,accountId,deckId)??[],updated_at:now}};
}
