import type { DataEnv } from './types.ts';

type OpsEnv = Pick<DataEnv, 'DB'>;

function bool(value: unknown): boolean { return Number(value) === 1; }
function cleanQuery(value: string): string { return value.trim().slice(0, 120); }
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export async function searchOpsAccounts(env: OpsEnv, rawQuery: string) {
  const query = cleanQuery(rawQuery);
  if (!query) return [];
  const pattern = likePattern(query);
  const result = await env.DB.prepare(`
    SELECT id, user_id, nickname, server_code, is_primary, updated_at
    FROM game_accounts
    WHERE id = ?
       OR user_id = ?
       OR nickname LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR server_code LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY updated_at DESC, id ASC
    LIMIT 50
  `).bind(query, query, pattern, pattern).all<{
    id:string; user_id:string; nickname:string; server_code:string; is_primary:number; updated_at:number;
  }>();
  return result.results.map((row) => ({ ...row, is_primary: bool(row.is_primary) }));
}

export async function getOpsAccountDetail(env: OpsEnv, accountId: string) {
  const account = await env.DB.prepare(`
    SELECT id, user_id, nickname, server_code, is_primary, created_at, updated_at
    FROM game_accounts WHERE id = ? LIMIT 1
  `).bind(accountId).first<{
    id:string; user_id:string; nickname:string; server_code:string; is_primary:number; created_at:number; updated_at:number;
  }>();
  if (!account) return null;

  const generals = await env.DB.prepare(`
    SELECT ug.general_id, g.name, ug.breakthrough, ug.promotion, ug.favorite, ug.note, ug.updated_at
    FROM user_generals ug JOIN game_generals g ON g.id = ug.general_id
    WHERE ug.account_id = ? AND ug.owned = 1
    ORDER BY g.name, ug.general_id
  `).bind(accountId).all<Record<string, unknown>>();
  const tactics = await env.DB.prepare(`
    SELECT ut.tactic_id, t.name, ut.breakthrough, ut.favorite, ut.note, ut.updated_at
    FROM user_tactics ut JOIN game_tactics t ON t.id = ut.tactic_id
    WHERE ut.account_id = ? AND ut.owned = 1
    ORDER BY t.name, ut.tactic_id
  `).bind(accountId).all<Record<string, unknown>>();
  const equipment = await env.DB.prepare(`
    SELECT ue.id, ue.template_id, et.name AS template_name, et.type, ue.nickname, ue.locked, ue.favorite, ue.created_at, ue.updated_at
    FROM user_equipment ue JOIN game_equipment_templates et ON et.id = ue.template_id
    WHERE ue.account_id = ?
    ORDER BY ue.created_at, ue.id
  `).bind(accountId).all<Record<string, unknown>>();
  const decks = await env.DB.prepare(`
    SELECT d.id, d.name, d.status, d.visibility, d.note, d.is_primary, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM deck_general_slots gs WHERE gs.deck_id = d.id) AS general_count,
      (SELECT COUNT(*) FROM deck_tactic_slots ts WHERE ts.deck_id = d.id) AS tactic_count,
      (SELECT COUNT(*) FROM deck_general_slots es WHERE es.deck_id = d.id AND es.weapon_instance_id IS NOT NULL)
        + (SELECT COUNT(*) FROM deck_general_slots es WHERE es.deck_id = d.id AND es.mount_instance_id IS NOT NULL) AS equipment_count
    FROM decks d
    WHERE d.account_id = ?
    ORDER BY d.is_primary DESC, d.updated_at DESC, d.id
  `).bind(accountId).all<Record<string, unknown>>();
  const snapshots = await env.DB.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS latest_created_at
    FROM deck_snapshots
    WHERE source_deck_id IN (SELECT id FROM decks WHERE account_id = ?)
  `).bind(accountId).first<{ count:number; latest_created_at:number|null }>();

  const mappedAccount = { ...account, is_primary: bool(account.is_primary) };
  const mappedGenerals = generals.results.map((row:any) => ({ ...row, favorite: bool(row.favorite) }));
  const mappedTactics = tactics.results.map((row:any) => ({ ...row, favorite: bool(row.favorite) }));
  const mappedEquipment = equipment.results.map((row:any) => ({ ...row, locked: bool(row.locked), favorite: bool(row.favorite) }));
  const mappedDecks = decks.results.map((row:any) => ({ ...row, is_primary: bool(row.is_primary) }));

  return {
    account: mappedAccount,
    generals: mappedGenerals,
    tactics: mappedTactics,
    equipment: mappedEquipment,
    decks: mappedDecks,
    snapshot_summary: { count: Number(snapshots?.count ?? 0), latest_created_at: snapshots?.latest_created_at ?? null },
    raw: {
      account: mappedAccount,
      counts: {
        generals: mappedGenerals.length,
        tactics: mappedTactics.length,
        equipment: mappedEquipment.length,
        decks: mappedDecks.length,
        snapshots: Number(snapshots?.count ?? 0),
      },
    },
  };
}

export async function getOpsDeckDetail(env: OpsEnv, accountId: string, deckId: string) {
  const deck = await env.DB.prepare(`
    SELECT d.id, d.account_id, a.user_id, d.name, d.season_id, d.status, d.visibility, d.note, d.is_primary, d.created_at, d.updated_at
    FROM decks d JOIN game_accounts a ON a.id = d.account_id
    WHERE d.id = ? AND d.account_id = ? LIMIT 1
  `).bind(deckId, accountId).first<Record<string, unknown> & { id:string; is_primary:number }>();
  if (!deck) return null;

  const generalRows = await env.DB.prepare(`
    SELECT gs.position, gs.general_id, g.name AS general_name,
      gs.weapon_instance_id, wt.name AS weapon_name,
      gs.mount_instance_id, mt.name AS mount_name
    FROM deck_general_slots gs
    JOIN game_generals g ON g.id = gs.general_id
    LEFT JOIN user_equipment w ON w.id = gs.weapon_instance_id
    LEFT JOIN game_equipment_templates wt ON wt.id = w.template_id
    LEFT JOIN user_equipment m ON m.id = gs.mount_instance_id
    LEFT JOIN game_equipment_templates mt ON mt.id = m.template_id
    WHERE gs.deck_id = ?
    ORDER BY gs.position
  `).bind(deckId).all<Record<string, unknown>>();
  const tacticRows = await env.DB.prepare(`
    SELECT ts.general_position, ts.slot, ts.tactic_id, t.name AS tactic_name
    FROM deck_tactic_slots ts JOIN game_tactics t ON t.id = ts.tactic_id
    WHERE ts.deck_id = ?
    ORDER BY ts.general_position, ts.slot
  `).bind(deckId).all<Record<string, unknown>>();
  const snapshot = await env.DB.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS latest_created_at
    FROM deck_snapshots WHERE source_deck_id = ?
  `).bind(deckId).first<{ count:number; latest_created_at:number|null }>();

  const tacticsByPosition = new Map<number, Record<string, unknown>[]>();
  for (const row of tacticRows.results as any[]) {
    const position = Number(row.general_position);
    const list = tacticsByPosition.get(position) ?? [];
    list.push({ slot:Number(row.slot), tactic_id:row.tactic_id, tactic_name:row.tactic_name });
    tacticsByPosition.set(position, list);
  }
  const generals = (generalRows.results as any[]).map((row) => ({
    position:Number(row.position),
    general_id:row.general_id,
    general_name:row.general_name,
    weapon:row.weapon_instance_id ? { id:row.weapon_instance_id, name:row.weapon_name } : null,
    mount:row.mount_instance_id ? { id:row.mount_instance_id, name:row.mount_name } : null,
    tactics:tacticsByPosition.get(Number(row.position)) ?? [],
  }));

  return {
    deck: { ...deck, is_primary: bool(deck.is_primary) },
    generals,
    snapshot_summary: { count:Number(snapshot?.count ?? 0), latest_created_at:snapshot?.latest_created_at ?? null },
    raw: {
      deck: { id:deck.id, account_id:deck.account_id, name:deck.name, status:deck.status, visibility:deck.visibility, updated_at:deck.updated_at },
      general_count: generals.length,
    },
  };
}