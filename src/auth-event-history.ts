import type { Env } from './types';
import { AUTH_EVENT_CATEGORY_SQL } from './auth-event-classification';

const denied = ['authorize.access_denied', 'discord.login.access_denied'] as const;
const errors = ['discord.login.error'] as const;
export type HistoryKind = 'problems' | 'denied' | 'errors' | 'refresh' | 'failures' | 'all';
type HistoryQuery = {
  readonly kind: HistoryKind; readonly since: number; readonly until: number;
  readonly before: number; readonly cursorId: string; readonly discordId: string;
  readonly limit: number; readonly summary: boolean;
};
export function parseHistoryQuery(params: URLSearchParams, now = Date.now()): HistoryQuery | null {
  const kind = params.get('kind') || 'problems';
  if (kind !== 'problems' && kind !== 'denied' && kind !== 'errors' && kind !== 'refresh' && kind !== 'failures' && kind !== 'all') return null;
  const since = Number(params.get('since') ?? 0), until = Number(params.get('until') ?? now);
  const before = Number(params.get('before') ?? until + 1), limit = Number(params.get('limit') ?? 50);
  const cursorId = params.get('cursor_id') || '', discordId = params.get('discord_id')?.trim() || '';
  if (![since, until, before, limit].every(Number.isSafeInteger) || since < 0 || until < since || until > now
    || before < 0 || before > until + 1 || limit < 1 || limit > 200 || cursorId.length > 200
    || (discordId && !/^\d{15,22}$/.test(discordId)) || (params.has('before') !== params.has('cursor_id'))) return null;
  return { kind, since, until, before, cursorId, discordId, limit, summary: params.get('summary') !== '0' };
}

export async function readAuthEventHistory(env: Env, clientId: string, query: HistoryQuery) {
  const types = query.kind === 'all' ? [] : query.kind === 'denied' ? denied : query.kind === 'errors' ? errors : [...denied, ...errors];
  const category = query.kind === 'refresh' ? `AND (${AUTH_EVENT_CATEGORY_SQL}) = 'refresh'`
    : query.kind === 'denied' ? `AND (${AUTH_EVENT_CATEGORY_SQL}) = 'denied'`
    : query.kind === 'failures' ? `AND (${AUTH_EVENT_CATEGORY_SQL}) IN ('denied','error')` : '';
  // Both queries share app, category, identity and time bounds. Pagination only affects rows, never totals.
  const where = `e.client_id = ? AND e.created_at >= ? AND e.created_at <= ?
    ${types.length ? `AND e.event_type IN (${types.map(() => '?').join(',')})` : ''}
    ${category}
    AND (? = '' OR EXISTS (SELECT 1 FROM auth_identities identity WHERE identity.user_id = e.user_id
      AND identity.provider = 'discord' AND identity.provider_user_id = ?)
      OR CASE WHEN json_valid(e.detail) THEN json_extract(e.detail, '$.discord_user_id') END = ?)`;
  const values = [clientId, query.since, query.until, ...types, query.discordId, query.discordId, query.discordId];
  const from = `FROM auth_events e LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN auth_identities i ON i.id = (SELECT identity.id FROM auth_identities identity
      WHERE identity.user_id = e.user_id AND identity.provider = 'discord' ORDER BY identity.created_at DESC, identity.id DESC LIMIT 1)`;
  const rows = env.DB.prepare(`SELECT e.id, e.client_id, e.user_id, e.event_type, e.created_at, e.detail, ${AUTH_EVENT_CATEGORY_SQL} AS category,
    u.display_name, i.provider_user_id AS discord_user_id ${from} WHERE ${where}
    AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).bind(...values, query.before, query.before, query.cursorId, query.limit + 1);
  const summary = env.DB.prepare(`SELECT e.event_type, ${AUTH_EVENT_CATEGORY_SQL} AS category,
    CASE WHEN json_valid(e.detail) THEN COALESCE(json_extract(e.detail, '$.diagnosis.reason'), json_extract(e.detail, '$.message')) END AS reason,
    COUNT(*) AS count, COUNT(DISTINCT e.user_id) AS identified_users,
    SUM(CASE WHEN e.user_id IS NULL THEN 1 ELSE 0 END) AS unidentified_events,
    MIN(e.created_at) AS first_at, MAX(e.created_at) AS last_at
    ${from} WHERE ${where} GROUP BY e.event_type, category, reason ORDER BY count DESC, e.event_type, reason`).bind(...values);
  const results = await env.DB.batch<Record<string, unknown>>(query.summary ? [rows, summary] : [rows]);
  const events = results[0].results.slice(0, query.limit);
  const last = events.at(-1);
  return { ok: true, events, has_more: results[0].results.length > query.limit,
    next_cursor: last ? { created_at: last.created_at, id: last.id } : null,
    filter: { kind: query.kind, since: query.since, until: query.until, discord_id: query.discordId },
    summary: query.summary ? results[1].results : null };
}
