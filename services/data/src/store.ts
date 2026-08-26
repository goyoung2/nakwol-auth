import type { DataEnv, DataPrincipal, DataScope } from './types.ts';

export async function upsertDataUser(env: Pick<DataEnv, 'DB'>, principal: DataPrincipal): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO data_users(id, first_seen_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`).bind(principal.userId, now, now).run();
}

export async function hasDataScope(env: Pick<DataEnv, 'DB'>, clientId: string, scope: DataScope): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS allowed FROM data_applications a JOIN data_application_scopes s ON s.client_id = a.client_id WHERE a.client_id = ? AND a.status = 'active' AND s.scope = ? LIMIT 1`).bind(clientId, scope).first<{ allowed: number }>();
  return Boolean(row?.allowed);
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
