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

type RegistryKind = 'generals' | 'tactics' | 'equipment';
export async function listRegistry(env: Pick<DataEnv, 'DB'>, kind: RegistryKind) {
  const sql = kind === 'generals'
    ? `SELECT id, name, unique_tactic_id, rarity, metadata_json FROM game_generals WHERE enabled = 1 ORDER BY name, id`
    : kind === 'tactics'
      ? `SELECT id, name, category, rarity, metadata_json FROM game_tactics WHERE enabled = 1 ORDER BY name, id`
      : `SELECT id, name, type, metadata_json FROM game_equipment_templates WHERE enabled = 1 ORDER BY type, name, id`;
  const result = await env.DB.prepare(sql).all<Record<string, unknown>>();
  return result.results.map((row) => {
    const { metadata_json, ...rest } = row;
    let metadata: unknown = {};
    try { metadata = JSON.parse(String(metadata_json ?? '{}')); } catch { metadata = {}; }
    return { ...rest, metadata };
  });
}
