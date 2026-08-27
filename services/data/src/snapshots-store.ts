import { newDataId } from './domain.ts';
import type { CreateSnapshotInput } from './decks-domain.ts';
import type { DataEnv } from './types.ts';

type SnapshotSourceDeckRow = {
  id:string;
  name:string;
  season_id:string|null;
  status:'active'|'candidate'|'research'|'archived';
  visibility:'private'|'alliance'|'public';
  note:string|null;
  is_primary:number;
  created_at:number;
  updated_at:number;
  account_nickname:string;
  server_code:string;
};

type SnapshotGeneralRow = {
  position:number;
  general_id:string;
  general_name:string;
  general_owned:number|null;
  general_breakthrough:number|null;
  general_promotion:number|null;
  weapon_id:string|null;
  weapon_template_id:string|null;
  weapon_template_name:string|null;
  weapon_type:'weapon'|'mount'|null;
  weapon_nickname:string|null;
  weapon_locked:number|null;
  weapon_favorite:number|null;
  mount_id:string|null;
  mount_template_id:string|null;
  mount_template_name:string|null;
  mount_type:'weapon'|'mount'|null;
  mount_nickname:string|null;
  mount_locked:number|null;
  mount_favorite:number|null;
};

type SnapshotTacticRow = {
  general_position:number;
  slot:number;
  tactic_id:string;
  tactic_name:string;
  tactic_owned:number|null;
  tactic_breakthrough:number|null;
};

type SnapshotTraitRow = {
  equipment_id:string;
  slot:number;
  trait_id:string;
  kind:'skill'|'effect'|null;
  name:string;
  description:string|null;
};

type StoredSnapshotRow = {
  id:string;
  source_deck_id:string|null;
  visibility:'alliance'|'public';
  snapshot_json:string;
  created_at:number;
};

export type SnapshotEquipmentTraitValue = {
  slot:number;
  trait_id:string;
  kind:'skill'|'effect'|null;
  name:string;
  description:string|null;
};

export type SnapshotEquipmentValue = {
  id:string;
  template_id:string;
  template_name:string;
  type:'weapon'|'mount';
  nickname:string|null;
  locked:boolean;
  favorite:boolean;
  traits:SnapshotEquipmentTraitValue[];
};

export type SnapshotPayload = {
  format_version:1;
  captured_at:number;
  account:{id:string;nickname:string;server_code:string};
  deck:{
    id:string;
    name:string;
    season_id:string|null;
    status:'active'|'candidate'|'research'|'archived';
    visibility:'private'|'alliance'|'public';
    note:string|null;
    is_primary:boolean;
    created_at:number;
    updated_at:number;
  };
  generals:Array<{
    position:number;
    general:{id:string;name:string;owned:boolean;breakthrough:number|null;promotion:number|null};
    weapon:SnapshotEquipmentValue|null;
    mount:SnapshotEquipmentValue|null;
    tactics:Array<{slot:number;tactic:{id:string;name:string;owned:boolean;breakthrough:number|null}}>;
  }>;
};

export type SnapshotData = {
  id:string;
  source_deck_id:string|null;
  visibility:'alliance'|'public';
  snapshot:unknown;
  created_at:number;
};

function mapEquipment(row:SnapshotGeneralRow,prefix:'weapon'|'mount',traitsByEquipment:Map<string,SnapshotEquipmentTraitValue[]>):SnapshotEquipmentValue|null {
  const id=prefix==='weapon'?row.weapon_id:row.mount_id;
  const templateId=prefix==='weapon'?row.weapon_template_id:row.mount_template_id;
  const templateName=prefix==='weapon'?row.weapon_template_name:row.mount_template_name;
  const type=prefix==='weapon'?row.weapon_type:row.mount_type;
  if(!id||!templateId||!templateName||!type) return null;
  return {
    id,
    template_id:templateId,
    template_name:templateName,
    type,
    nickname:prefix==='weapon'?row.weapon_nickname:row.mount_nickname,
    locked:Boolean(prefix==='weapon'?row.weapon_locked:row.mount_locked),
    favorite:Boolean(prefix==='weapon'?row.weapon_favorite:row.mount_favorite),
    traits:traitsByEquipment.get(id)??[],
  };
}

function parseStoredSnapshot(row:StoredSnapshotRow):SnapshotData {
  return {
    id:row.id,
    source_deck_id:row.source_deck_id,
    visibility:row.visibility,
    snapshot:JSON.parse(row.snapshot_json) as unknown,
    created_at:row.created_at,
  };
}

async function getOwnedSnapshotSourceDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<SnapshotSourceDeckRow|null> {
  return env.DB.prepare(`SELECT d.id,d.name,d.season_id,d.status,d.visibility,d.note,d.is_primary,d.created_at,d.updated_at,
      ga.nickname AS account_nickname,ga.server_code
    FROM decks d
    JOIN game_accounts ga ON ga.id=d.account_id
    WHERE d.id=? AND d.account_id=? AND ga.user_id=?
    LIMIT 1`).bind(deckId,accountId,userId).first<SnapshotSourceDeckRow>();
}

async function loadSnapshotEquipmentTraits(env:Pick<DataEnv,'DB'>,accountId:string):Promise<Map<string,SnapshotEquipmentTraitValue[]>> {
  const result=await env.DB.prepare(`SELECT ut.equipment_id,ut.slot,gt.id AS trait_id,gt.kind,gt.name,gt.description
    FROM user_equipment_traits ut
    JOIN user_equipment ue ON ue.id=ut.equipment_id
    JOIN game_equipment_traits gt ON gt.id=ut.trait_id
    WHERE ue.account_id=?
    ORDER BY ut.equipment_id,ut.slot`).bind(accountId).all<SnapshotTraitRow>();
  const grouped=new Map<string,SnapshotEquipmentTraitValue[]>();
  for(const row of result.results){
    const list=grouped.get(row.equipment_id)??[];
    list.push({slot:row.slot,trait_id:row.trait_id,kind:row.kind,name:row.name,description:row.description});
    grouped.set(row.equipment_id,list);
  }
  return grouped;
}

export type CreateDeckSnapshotResult = {kind:'deck_not_found'}|{kind:'ok';data:SnapshotData};
export async function createDeckSnapshot(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string,input:CreateSnapshotInput):Promise<CreateDeckSnapshotResult> {
  const deck=await getOwnedSnapshotSourceDeck(env,userId,accountId,deckId);
  if(!deck) return {kind:'deck_not_found'};

  const [generalRows,tacticRows,traitsByEquipment]=await Promise.all([
    env.DB.prepare(`SELECT gs.position,gs.general_id,g.name AS general_name,
        ug.owned AS general_owned,ug.breakthrough AS general_breakthrough,ug.promotion AS general_promotion,
        w.id AS weapon_id,w.template_id AS weapon_template_id,wt.name AS weapon_template_name,wt.type AS weapon_type,w.nickname AS weapon_nickname,w.locked AS weapon_locked,w.favorite AS weapon_favorite,
        m.id AS mount_id,m.template_id AS mount_template_id,mt.name AS mount_template_name,mt.type AS mount_type,m.nickname AS mount_nickname,m.locked AS mount_locked,m.favorite AS mount_favorite
      FROM deck_general_slots gs
      JOIN game_generals g ON g.id=gs.general_id
      LEFT JOIN user_generals ug ON ug.account_id=? AND ug.general_id=gs.general_id AND ug.owned=1
      LEFT JOIN user_equipment w ON w.id=gs.weapon_instance_id AND w.account_id=?
      LEFT JOIN game_equipment_templates wt ON wt.id=w.template_id
      LEFT JOIN user_equipment m ON m.id=gs.mount_instance_id AND m.account_id=?
      LEFT JOIN game_equipment_templates mt ON mt.id=m.template_id
      WHERE gs.deck_id=?
      ORDER BY gs.position`).bind(accountId,accountId,accountId,deckId).all<SnapshotGeneralRow>(),
    env.DB.prepare(`SELECT ts.general_position,ts.slot,ts.tactic_id,t.name AS tactic_name,
        ut.owned AS tactic_owned,ut.breakthrough AS tactic_breakthrough
      FROM deck_tactic_slots ts
      JOIN game_tactics t ON t.id=ts.tactic_id
      LEFT JOIN user_tactics ut ON ut.account_id=? AND ut.tactic_id=ts.tactic_id AND ut.owned=1
      WHERE ts.deck_id=?
      ORDER BY ts.general_position,ts.slot`).bind(accountId,deckId).all<SnapshotTacticRow>(),
    loadSnapshotEquipmentTraits(env,accountId),
  ]);

  const tacticsByPosition=new Map<number,SnapshotPayload['generals'][number]['tactics']>();
  for(const row of tacticRows.results){
    const list=tacticsByPosition.get(row.general_position)??[];
    const owned=Boolean(row.tactic_owned);
    list.push({
      slot:row.slot,
      tactic:{
        id:row.tactic_id,
        name:row.tactic_name,
        owned,
        breakthrough:owned?row.tactic_breakthrough:null,
      },
    });
    tacticsByPosition.set(row.general_position,list);
  }

  const now=Date.now();
  const payload:SnapshotPayload={
    format_version:1,
    captured_at:now,
    account:{id:accountId,nickname:deck.account_nickname,server_code:deck.server_code},
    deck:{
      id:deck.id,
      name:deck.name,
      season_id:deck.season_id,
      status:deck.status,
      visibility:deck.visibility,
      note:deck.note,
      is_primary:Boolean(deck.is_primary),
      created_at:deck.created_at,
      updated_at:deck.updated_at,
    },
    generals:generalRows.results.map((row)=>{
      const owned=Boolean(row.general_owned);
      return {
        position:row.position,
        general:{
          id:row.general_id,
          name:row.general_name,
          owned,
          breakthrough:owned?row.general_breakthrough:null,
          promotion:owned?row.general_promotion:null,
        },
        weapon:mapEquipment(row,'weapon',traitsByEquipment),
        mount:mapEquipment(row,'mount',traitsByEquipment),
        tactics:tacticsByPosition.get(row.position)??[],
      };
    }),
  };

  const id=newDataId('dks');
  await env.DB.prepare(`INSERT INTO deck_snapshots(id,source_deck_id,owner_user_id,visibility,snapshot_json,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(id,deckId,userId,input.visibility,JSON.stringify(payload),now).run();
  return {kind:'ok',data:{id,source_deck_id:deckId,visibility:input.visibility,snapshot:payload,created_at:now}};
}

export async function listDeckSnapshots(env:Pick<DataEnv,'DB'>,userId:string):Promise<SnapshotData[]> {
  const result=await env.DB.prepare(`SELECT id,source_deck_id,visibility,snapshot_json,created_at FROM deck_snapshots WHERE owner_user_id=? ORDER BY created_at DESC,id`)
    .bind(userId).all<StoredSnapshotRow>();
  return result.results.map(parseStoredSnapshot);
}

export async function getDeckSnapshot(env:Pick<DataEnv,'DB'>,userId:string,snapshotId:string):Promise<SnapshotData|null> {
  const row=await env.DB.prepare(`SELECT id,source_deck_id,visibility,snapshot_json,created_at FROM deck_snapshots WHERE id=? AND owner_user_id=? LIMIT 1`)
    .bind(snapshotId,userId).first<StoredSnapshotRow>();
  return row?parseStoredSnapshot(row):null;
}
