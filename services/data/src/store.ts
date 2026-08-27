import type { DataEnv, DataPrincipal, DataScope } from './types.ts';
import { isCanonicalOwnableTacticMetadata, newDataId } from './domain.ts';
import type { CreateEquipmentInput, OwnedGeneralInput, OwnedTacticInput, PatchEquipmentInput } from './domain.ts';

export async function upsertDataUser(env: Pick<DataEnv, 'DB'>, principal: DataPrincipal): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO data_users(id, first_seen_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`).bind(principal.userId, now, now).run();
}

export async function hasDataScope(env: Pick<DataEnv, 'DB'>, clientId: string, scope: DataScope): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS allowed FROM data_applications a JOIN data_application_scopes s ON s.client_id = a.client_id WHERE a.client_id = ? AND a.status = 'active' AND s.scope = ? LIMIT 1`).bind(clientId, scope).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

export async function getDataApplicationState(env: Pick<DataEnv, 'DB'>, clientId: string) {
  const app = await env.DB.prepare(`SELECT status FROM data_applications WHERE client_id = ?`).bind(clientId).first<{ status:'active'|'disabled' }>();
  if (!app) return { registered:false, status:null, scopes:[] as string[] };
  const result = await env.DB.prepare(`SELECT scope FROM data_application_scopes WHERE client_id = ? ORDER BY scope`).bind(clientId).all<{ scope:string }>();
  return { registered:true, status:app.status, scopes:(result.results || []).map((row) => row.scope) };
}

export async function replaceDataApplicationScopes(env: Pick<DataEnv, 'DB'>, clientId: string, status: 'active'|'disabled', scopes: DataScope[]) {
  const now = Date.now();
  const statements: any[] = [
    env.DB.prepare(`INSERT INTO data_applications(client_id,status,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`).bind(clientId,status,now,now),
    env.DB.prepare(`DELETE FROM data_application_scopes WHERE client_id = ?`).bind(clientId),
  ];
  for (const scope of scopes) statements.push(env.DB.prepare(`INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES (?,?,?)`).bind(clientId,scope,now));
  await env.DB.batch(statements);
  return getDataApplicationState(env, clientId);
}

export async function listGameAccounts(env: Pick<DataEnv, 'DB'>, userId: string) {
  const result = await env.DB.prepare(`SELECT id, nickname, server_code, is_primary, created_at, updated_at FROM game_accounts WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC`).bind(userId).all<{ id:string; nickname:string; server_code:string; is_primary:number; created_at:number; updated_at:number }>();
  return result.results.map((row) => ({ ...row, is_primary: Boolean(row.is_primary) }));
}

export async function createGameAccount(env: Pick<DataEnv, 'DB'>, userId: string, input: { id:string; nickname:string; serverCode:string; isPrimary:boolean }) {
  const now = Date.now();
  const insert = env.DB.prepare(`INSERT INTO game_accounts(id, user_id, nickname, server_code, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(input.id, userId, input.nickname, input.serverCode, input.isPrimary ? 1 : 0, now, now);
  if (input.isPrimary) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE game_accounts SET is_primary = 0, updated_at = ? WHERE user_id = ? AND is_primary = 1`).bind(now, userId),
      insert,
    ]);
  } else await insert.run();
  return { id:input.id, nickname:input.nickname, server_code:input.serverCode, is_primary:input.isPrimary, created_at:now, updated_at:now };
}

export type RegistryKind = 'generals' | 'tactics' | 'equipment' | 'stats' | 'formations' | 'warbooks';
export interface RegistryListOptions { includeHidden?: boolean; }
type RegistryResultRow = Record<string, unknown> & { metadata_json?: string };
function parseRegistryRows(rows: RegistryResultRow[]) {
  return rows.map((row) => {
    const { metadata_json, ...rest } = row;
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(String(metadata_json ?? '{}')) as Record<string, unknown>; } catch { metadata = {}; }
    return { ...rest, native_id: metadata.native_id ?? null, metadata };
  });
}

export async function listRegistry(env: Pick<DataEnv, 'DB'>, kind: RegistryKind, options: RegistryListOptions = {}) {
  let sql: string;
  if (kind === 'generals') sql = `SELECT id, name, unique_tactic_id, rarity, enabled, metadata_json FROM game_generals ${options.includeHidden ? '' : 'WHERE enabled = 1'} ORDER BY name, id`;
  else if (kind === 'tactics') sql = `SELECT id, name, category, rarity, enabled, metadata_json FROM game_tactics WHERE enabled = 1 ORDER BY name, id`;
  else if (kind === 'equipment') sql = `SELECT id, name, type, enabled, metadata_json FROM game_equipment_templates WHERE enabled = 1 ORDER BY type, name, id`;
  else if (kind === 'stats') sql = `SELECT id, name, enabled, metadata_json FROM game_stat_types WHERE enabled = 1 ORDER BY name, id`;
  else if (kind === 'formations') sql = `SELECT id, name, description, enabled, metadata_json FROM game_formations WHERE enabled = 1 ORDER BY id`;
  else sql = `SELECT id, name, quality, type, related_tactic_id, description, enabled, metadata_json FROM game_warbooks WHERE enabled = 1 ORDER BY id`;
  const result = await env.DB.prepare(sql).all<RegistryResultRow>();
  return parseRegistryRows(result.results);
}

async function scalar(env: Pick<DataEnv, 'DB'>, sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function getRegistrySummary(env: Pick<DataEnv, 'DB'>) {
  const metaRows = await env.DB.prepare(`SELECT key, value FROM data_registry_meta WHERE key IN ('seed_version','source_json','source_counts_json')`).all<{ key:string; value:string }>();
  const meta = Object.fromEntries(metaRows.results.map((row) => [row.key, row.value])) as Record<string, string | undefined>;
  const schema = await env.DB.prepare(`SELECT value FROM data_schema_meta WHERE key = 'schema_version'`).first<{ value:string }>();
  let source: unknown = {};
  let declaredCounts: unknown = {};
  try { source = JSON.parse(meta.source_json ?? '{}'); } catch { source = {}; }
  try { declaredCounts = JSON.parse(meta.source_counts_json ?? '{}'); } catch { declaredCounts = {}; }
  return {
    seed_version: meta.seed_version ?? null,
    schema_version: Number(schema?.value ?? 0),
    source,
    declared_counts: declaredCounts,
    counts: {
      generals: await scalar(env, `SELECT COUNT(*) AS n FROM game_generals`),
      generals_enabled: await scalar(env, `SELECT COUNT(*) AS n FROM game_generals WHERE enabled = 1`),
      tactics: await scalar(env, `SELECT COUNT(*) AS n FROM game_tactics`),
      equipment: await scalar(env, `SELECT COUNT(*) AS n FROM game_equipment_templates`),
      stat_types: await scalar(env, `SELECT COUNT(*) AS n FROM game_stat_types`),
      formations: await scalar(env, `SELECT COUNT(*) AS n FROM game_formations`),
      warbooks: await scalar(env, `SELECT COUNT(*) AS n FROM game_warbooks`),
    },
  };
}

async function ownsGameAccount(env: Pick<DataEnv, 'DB'>, userId: string, accountId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS owned FROM game_accounts WHERE id = ? AND user_id = ? LIMIT 1`).bind(accountId, userId).first<{ owned:number }>();
  return Boolean(row?.owned);
}

export async function listOwnedGenerals(env: Pick<DataEnv, 'DB'>, userId: string, accountId: string) {
  if (!await ownsGameAccount(env, userId, accountId)) return null;
  const result = await env.DB.prepare(`SELECT ug.general_id, g.name, ug.breakthrough, ug.promotion, ug.favorite, ug.note, ug.updated_at FROM user_generals ug JOIN game_generals g ON g.id = ug.general_id WHERE ug.account_id = ? AND ug.owned = 1 ORDER BY g.name, ug.general_id`).bind(accountId).all<{ general_id:string; name:string; breakthrough:number; promotion:number; favorite:number; note:string|null; updated_at:number }>();
  return result.results.map((row) => ({ ...row, favorite:Boolean(row.favorite) }));
}

export type UpsertOwnedGeneralResult =
  | { kind:'account_not_found' }
  | { kind:'general_not_found' }
  | { kind:'ok'; data:{ general_id:string; name:string; breakthrough:number; promotion:number; favorite:boolean; note:string|null; updated_at:number } };

export async function upsertOwnedGeneral(env: Pick<DataEnv, 'DB'>, userId: string, accountId: string, generalId: string, input: OwnedGeneralInput): Promise<UpsertOwnedGeneralResult> {
  if (!await ownsGameAccount(env, userId, accountId)) return { kind:'account_not_found' };
  const general = await env.DB.prepare(`SELECT id, name FROM game_generals WHERE id = ? AND enabled = 1 LIMIT 1`).bind(generalId).first<{ id:string; name:string }>();
  if (!general) return { kind:'general_not_found' };
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO user_generals(account_id,general_id,owned,breakthrough,promotion,favorite,note,updated_at) VALUES (?,?,1,?,?,?,?,?) ON CONFLICT(account_id,general_id) DO UPDATE SET owned=1, breakthrough=excluded.breakthrough, promotion=excluded.promotion, favorite=excluded.favorite, note=excluded.note, updated_at=excluded.updated_at`).bind(accountId,generalId,input.breakthrough,input.promotion,input.favorite?1:0,input.note,now).run();
  return { kind:'ok', data:{ general_id:generalId, name:general.name, breakthrough:input.breakthrough, promotion:input.promotion, favorite:input.favorite, note:input.note, updated_at:now } };
}

export type DeleteOwnedGeneralResult = { kind:'account_not_found' } | { kind:'ok'; data:{ deleted:true; general_id:string } };
export async function deleteOwnedGeneral(env: Pick<DataEnv, 'DB'>, userId: string, accountId: string, generalId: string): Promise<DeleteOwnedGeneralResult> {
  if (!await ownsGameAccount(env, userId, accountId)) return { kind:'account_not_found' };
  await env.DB.prepare(`DELETE FROM user_generals WHERE account_id = ? AND general_id = ?`).bind(accountId, generalId).run();
  return { kind:'ok', data:{ deleted:true, general_id:generalId } };
}

export async function listOwnedTactics(env: Pick<DataEnv, 'DB'>, userId: string, accountId: string) {
  if (!await ownsGameAccount(env, userId, accountId)) return null;
  const result = await env.DB.prepare(`SELECT ut.tactic_id, t.name, ut.breakthrough, ut.favorite, ut.note, ut.updated_at FROM user_tactics ut JOIN game_tactics t ON t.id = ut.tactic_id WHERE ut.account_id = ? AND ut.owned = 1 ORDER BY t.name, ut.tactic_id`).bind(accountId).all<{ tactic_id:string; name:string; breakthrough:number; favorite:number; note:string|null; updated_at:number }>();
  return result.results.map((row) => ({ ...row, favorite:Boolean(row.favorite) }));
}

type TacticRegistryRow = { id:string; name:string; metadata_json:string };
async function getCanonicalOwnableTactic(env: Pick<DataEnv, 'DB'>, tacticId:string):Promise<{id:string;name:string}|null> {
  const tactic = await env.DB.prepare(`SELECT id, name, metadata_json FROM game_tactics WHERE id = ? AND enabled = 1 LIMIT 1`).bind(tacticId).first<TacticRegistryRow>();
  if (!tactic) return null;
  let metadata:Record<string,unknown> = {};
  try { metadata = JSON.parse(tactic.metadata_json || '{}') as Record<string,unknown>; } catch { return null; }
  if (!isCanonicalOwnableTacticMetadata(metadata)) return null;
  const unique = await env.DB.prepare(`SELECT 1 AS matched FROM game_generals WHERE unique_tactic_id = ? LIMIT 1`).bind(tacticId).first<{matched:number}>();
  if (unique) return null;
  return { id:tactic.id, name:tactic.name };
}

export type UpsertOwnedTacticResult =
  | { kind:'account_not_found' }
  | { kind:'tactic_not_found' }
  | { kind:'ok'; data:{ tactic_id:string; name:string; breakthrough:number; favorite:boolean; note:string|null; updated_at:number } };

export async function upsertOwnedTactic(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, tacticId:string, input:OwnedTacticInput):Promise<UpsertOwnedTacticResult> {
  if (!await ownsGameAccount(env, userId, accountId)) return { kind:'account_not_found' };
  const tactic = await getCanonicalOwnableTactic(env, tacticId);
  if (!tactic) return { kind:'tactic_not_found' };
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO user_tactics(account_id,tactic_id,owned,breakthrough,favorite,note,updated_at) VALUES (?,?,1,?,?,?,?) ON CONFLICT(account_id,tactic_id) DO UPDATE SET owned=1, breakthrough=excluded.breakthrough, favorite=excluded.favorite, note=excluded.note, updated_at=excluded.updated_at`).bind(accountId,tacticId,input.breakthrough,input.favorite?1:0,input.note,now).run();
  return { kind:'ok', data:{ tactic_id:tacticId, name:tactic.name, breakthrough:input.breakthrough, favorite:input.favorite, note:input.note, updated_at:now } };
}

export type DeleteOwnedTacticResult = { kind:'account_not_found' } | { kind:'ok'; data:{ deleted:true; tactic_id:string } };
export async function deleteOwnedTactic(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, tacticId:string):Promise<DeleteOwnedTacticResult> {
  if (!await ownsGameAccount(env, userId, accountId)) return { kind:'account_not_found' };
  await env.DB.prepare(`DELETE FROM user_tactics WHERE account_id = ? AND tactic_id = ?`).bind(accountId, tacticId).run();
  return { kind:'ok', data:{ deleted:true, tactic_id:tacticId } };
}

type EquipmentRow = {
  id:string; template_id:string; template_name:string; type:'weapon'|'mount'; nickname:string|null;
  locked:number; favorite:number; created_at:number; updated_at:number;
};
function mapEquipment(row:EquipmentRow) {
  return { ...row, locked:Boolean(row.locked), favorite:Boolean(row.favorite) };
}

export async function listEquipment(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string) {
  if (!await ownsGameAccount(env, userId, accountId)) return null;
  const result = await env.DB.prepare(`SELECT ue.id, ue.template_id, et.name AS template_name, et.type, ue.nickname, ue.locked, ue.favorite, ue.created_at, ue.updated_at FROM user_equipment ue JOIN game_equipment_templates et ON et.id = ue.template_id WHERE ue.account_id = ? ORDER BY ue.created_at, ue.id`).bind(accountId).all<EquipmentRow>();
  return result.results.map(mapEquipment);
}

export type CreateEquipmentResult =
  | { kind:'account_not_found' }
  | { kind:'template_not_found' }
  | { kind:'ok'; data:ReturnType<typeof mapEquipment> };
export async function createEquipment(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, input:CreateEquipmentInput):Promise<CreateEquipmentResult> {
  if (!await ownsGameAccount(env, userId, accountId)) return { kind:'account_not_found' };
  const template = await env.DB.prepare(`SELECT id, name, type FROM game_equipment_templates WHERE id = ? AND enabled = 1 LIMIT 1`).bind(input.templateId).first<{id:string;name:string;type:'weapon'|'mount'}>();
  if (!template) return { kind:'template_not_found' };
  const id = newDataId('eqp');
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id,accountId,template.id,input.nickname,input.locked?1:0,input.favorite?1:0,now,now).run();
  return { kind:'ok', data:{ id, template_id:template.id, template_name:template.name, type:template.type, nickname:input.nickname, locked:input.locked, favorite:input.favorite, created_at:now, updated_at:now } };
}

async function getOwnedEquipment(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, equipmentId:string):Promise<EquipmentRow|null> {
  return env.DB.prepare(`SELECT ue.id, ue.template_id, et.name AS template_name, et.type, ue.nickname, ue.locked, ue.favorite, ue.created_at, ue.updated_at FROM user_equipment ue JOIN game_accounts ga ON ga.id = ue.account_id JOIN game_equipment_templates et ON et.id = ue.template_id WHERE ue.id = ? AND ue.account_id = ? AND ga.user_id = ? LIMIT 1`).bind(equipmentId,accountId,userId).first<EquipmentRow>();
}

export type PatchEquipmentResult = { kind:'equipment_not_found' } | { kind:'ok'; data:ReturnType<typeof mapEquipment> };
export async function patchEquipment(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, equipmentId:string, input:PatchEquipmentInput):Promise<PatchEquipmentResult> {
  const current = await getOwnedEquipment(env,userId,accountId,equipmentId);
  if (!current) return { kind:'equipment_not_found' };
  const nickname = input.hasNickname ? input.nickname : current.nickname;
  const locked = input.hasLocked ? input.locked : Boolean(current.locked);
  const favorite = input.hasFavorite ? input.favorite : Boolean(current.favorite);
  const now = Date.now();
  await env.DB.prepare(`UPDATE user_equipment SET nickname = ?, locked = ?, favorite = ?, updated_at = ? WHERE id = ? AND account_id = ?`).bind(nickname,locked?1:0,favorite?1:0,now,equipmentId,accountId).run();
  return { kind:'ok', data:{ id:current.id, template_id:current.template_id, template_name:current.template_name, type:current.type, nickname, locked, favorite, created_at:current.created_at, updated_at:now } };
}

export type DeleteEquipmentResult = { kind:'equipment_not_found' } | { kind:'ok'; data:{ deleted:true; id:string } };
export async function deleteEquipment(env: Pick<DataEnv, 'DB'>, userId:string, accountId:string, equipmentId:string):Promise<DeleteEquipmentResult> {
  const current = await getOwnedEquipment(env,userId,accountId,equipmentId);
  if (!current) return { kind:'equipment_not_found' };
  await env.DB.prepare(`DELETE FROM user_equipment WHERE id = ? AND account_id = ?`).bind(equipmentId,accountId).run();
  return { kind:'ok', data:{ deleted:true, id:equipmentId } };
}
