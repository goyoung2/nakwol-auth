import { newDataId } from './domain.ts';
import type { CreateDeckInput, PatchDeckInput } from './decks-domain.ts';
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

function mapDeck<T extends DeckRow>(row:T) {
  return { ...row, is_primary:Boolean(row.is_primary) };
}

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

export async function listDecks(env:Pick<DataEnv,'DB'>,userId:string,accountId:string) {
  if(!await ownsGameAccount(env,userId,accountId)) return null;
  const result=await env.DB.prepare(`SELECT d.id,d.name,d.season_id,d.status,d.visibility,d.note,d.is_primary,d.created_at,d.updated_at,
      (SELECT COUNT(*) FROM deck_general_slots gs WHERE gs.deck_id=d.id) AS general_count,
      (SELECT COUNT(*) FROM deck_tactic_slots ts WHERE ts.deck_id=d.id) AS tactic_count,
      (SELECT COUNT(weapon_instance_id)+COUNT(mount_instance_id) FROM deck_general_slots es WHERE es.deck_id=d.id) AS equipment_count
    FROM decks d
    JOIN game_accounts ga ON ga.id=d.account_id
    WHERE d.account_id=? AND ga.user_id=?
    ORDER BY d.is_primary DESC,d.updated_at DESC,d.id`).bind(accountId,userId).all<DeckListRow>();
  return result.results.map(mapDeck);
}

export type CreateDeckResult =
  | {kind:'account_not_found'}
  | {kind:'season_not_found'}
  | {kind:'ok';data:ReturnType<typeof mapDeck<DeckRow>>};

export async function createDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,input:CreateDeckInput):Promise<CreateDeckResult> {
  if(!await ownsGameAccount(env,userId,accountId)) return {kind:'account_not_found'};
  if(!await seasonExists(env,input.seasonId)) return {kind:'season_not_found'};
  const id=newDataId('dek');
  const now=Date.now();
  await env.DB.prepare(`INSERT INTO decks(id,account_id,name,season_id,status,visibility,note,is_primary,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,accountId,input.name,input.seasonId,input.status,input.visibility,input.note,input.isPrimary?1:0,now,now).run();
  return {kind:'ok',data:{id,name:input.name,season_id:input.seasonId,status:input.status,visibility:input.visibility,note:input.note,is_primary:input.isPrimary,created_at:now,updated_at:now}};
}

export type GetDeckResult = {kind:'deck_not_found'} | {kind:'ok';data:ReturnType<typeof mapDeck<DeckRow>>};
export async function getDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<GetDeckResult> {
  const row=await getOwnedDeckRow(env,userId,accountId,deckId);
  if(!row) return {kind:'deck_not_found'};
  return {kind:'ok',data:mapDeck(row)};
}

export type PatchDeckResult =
  | {kind:'deck_not_found'}
  | {kind:'season_not_found'}
  | {kind:'ok';data:ReturnType<typeof mapDeck<DeckRow>>};

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

export type DeleteDeckResult = {kind:'deck_not_found'} | {kind:'ok';data:{deleted:true;id:string}};
export async function deleteDeck(env:Pick<DataEnv,'DB'>,userId:string,accountId:string,deckId:string):Promise<DeleteDeckResult> {
  const current=await getOwnedDeckRow(env,userId,accountId,deckId);
  if(!current) return {kind:'deck_not_found'};
  await env.DB.prepare(`DELETE FROM decks WHERE id=? AND account_id=?`).bind(deckId,accountId).run();
  return {kind:'ok',data:{deleted:true,id:deckId}};
}
