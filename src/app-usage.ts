import type { Env } from './types';
import { AUTH_EVENT_CATEGORY_SQL } from './auth-event-classification';

/** Login, SSO and silent SSO each mark the start of an authenticated use session. */
export const USAGE_SESSION_EVENTS = ['discord.login.success', 'authorize.sso', 'authorize.sso_auto'] as const;
export const USAGE_DENIED_EVENTS = ['authorize.access_denied', 'discord.login.access_denied'] as const;
export const USAGE_PERIODS = [7, 30, 90] as const;
export const USAGE_TOP_USERS = 50;

const DAY_MS = 86400000;
// Daily buckets follow Korean calendar days so "today" matches what operators expect.
const KST_OFFSET_MS = 9 * 3600000;
const SESSION_IN = USAGE_SESSION_EVENTS.map(() => '?').join(',');
const DENIED_IN = USAGE_DENIED_EVENTS.map(() => '?').join(',');
const DAY_EXPR = `CAST((e.created_at + ${KST_OFFSET_MS}) / ${DAY_MS} AS INTEGER)`;

export type UsagePeriod = typeof USAGE_PERIODS[number];

export function parseUsagePeriod(value: string | undefined): UsagePeriod | null {
  if (value === undefined || value === '') return 30;
  const days = Number(value);
  return USAGE_PERIODS.find((period) => period === days) ?? null;
}

function dayLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export async function readAppUsage(env: Env, clientId: string, days: UsagePeriod, now = Date.now()) {
  const today = Math.floor((now + KST_OFFSET_MS) / DAY_MS);
  const firstDay = today - days + 1;
  const since = firstDay * DAY_MS - KST_OFFSET_MS;
  // One D1 batch runs as a single transaction, so every aggregate reads the same snapshot;
  // the shared [since, now] window keeps later writes out of all of them.
  const [summaryResult, deniedResult, daily, users, recoveryResult] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT COUNT(*) AS sessions, COUNT(DISTINCT e.user_id) AS users FROM auth_events e
      WHERE e.client_id = ? AND e.created_at >= ? AND e.created_at <= ? AND e.event_type IN (${SESSION_IN})`)
      .bind(clientId, since, now, ...USAGE_SESSION_EVENTS),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN category IN ('refresh','denied') THEN 1 ELSE 0 END) AS denied,
      COUNT(DISTINCT CASE WHEN category IN ('refresh','denied') THEN user_id END) AS denied_users,
      SUM(CASE WHEN category = 'refresh' THEN 1 ELSE 0 END) AS refresh_required,
      SUM(CASE WHEN category = 'denied' THEN 1 ELSE 0 END) AS access_denied,
      SUM(CASE WHEN category = 'error' THEN 1 ELSE 0 END) AS authentication_errors
      FROM (SELECT e.user_id, ${AUTH_EVENT_CATEGORY_SQL} AS category FROM auth_events e
        WHERE e.client_id = ? AND e.created_at >= ? AND e.created_at <= ?
        AND e.event_type IN ('authorize.access_denied','discord.login.access_denied','discord.login.error'))`)
      .bind(clientId, since, now),
    env.DB.prepare(`SELECT ${DAY_EXPR} AS day, COUNT(*) AS sessions, COUNT(DISTINCT e.user_id) AS users FROM auth_events e
      WHERE e.client_id = ? AND e.created_at >= ? AND e.created_at <= ? AND e.event_type IN (${SESSION_IN}) GROUP BY day`)
      .bind(clientId, since, now, ...USAGE_SESSION_EVENTS),
    env.DB.prepare(`SELECT e.user_id, u.display_name, u.avatar_url, i.provider_user_id AS discord_user_id,
        COUNT(*) AS sessions, COUNT(DISTINCT ${DAY_EXPR}) AS active_days, MIN(e.created_at) AS first_used_at, MAX(e.created_at) AS last_used_at
      FROM auth_events e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN auth_identities i ON i.user_id = e.user_id AND i.provider = 'discord'
      WHERE e.client_id = ? AND e.created_at >= ? AND e.created_at <= ? AND e.event_type IN (${SESSION_IN}) AND e.user_id IS NOT NULL
      GROUP BY e.user_id ORDER BY sessions DESC, last_used_at DESC, e.user_id LIMIT ?`)
      .bind(clientId, since, now, ...USAGE_SESSION_EVENTS, USAGE_TOP_USERS),
    env.DB.prepare(`SELECT COUNT(*) AS affected_users,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM auth_events s WHERE s.client_id = ? AND s.user_id = d.user_id
        AND s.created_at > d.last_denied AND s.created_at <= ? AND s.event_type IN (${SESSION_IN})) THEN 1 ELSE 0 END) AS recovered_users
      FROM (SELECT e.user_id, MAX(e.created_at) AS last_denied FROM auth_events e
        WHERE e.client_id = ? AND e.created_at >= ? AND e.created_at <= ? AND e.user_id IS NOT NULL
        AND e.event_type IN (${DENIED_IN}) GROUP BY e.user_id) d`)
      .bind(clientId, now, ...USAGE_SESSION_EVENTS, clientId, since, now, ...USAGE_DENIED_EVENTS),
  ]);
  const summary = summaryResult.results?.[0] as { sessions: number; users: number } | undefined;
  const denied = deniedResult.results?.[0] as { denied: number; denied_users: number } | undefined;
  const failures = deniedResult.results?.[0];
  const recovery = recoveryResult.results?.[0];
  // Return every day in the window, including idle days, so charts keep a true time axis.
  const byDay = new Map(((daily.results ?? []) as { day: number; sessions: number; users: number }[]).map((row) => [Number(row.day), row]));
  return {
    days,
    since,
    until: now,
    timezone: 'Asia/Seoul',
    summary: {
      sessions: Number(summary?.sessions ?? 0),
      users: Number(summary?.users ?? 0),
      denied: Number(denied?.denied ?? 0),
      denied_users: Number(denied?.denied_users ?? 0),
    },
    failure_summary: {
      refresh_required: Number(failures?.refresh_required ?? 0),
      access_denied: Number(failures?.access_denied ?? 0),
      authentication_errors: Number(failures?.authentication_errors ?? 0),
      recovered_users: Number(recovery?.recovered_users ?? 0),
      unresolved_users: Number(recovery?.affected_users ?? 0) - Number(recovery?.recovered_users ?? 0),
    },
    daily: Array.from({ length: days }, (_, index) => {
      const day = firstDay + index, row = byDay.get(day);
      return { date: dayLabel(day), sessions: Number(row?.sessions ?? 0), users: Number(row?.users ?? 0) };
    }),
    users: ((users.results ?? []) as { user_id: string; display_name: string | null; avatar_url: string | null; discord_user_id: string | null;
      sessions: number; active_days: number; first_used_at: number; last_used_at: number }[]).map((row) => ({
      user_id: row.user_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      discord_user_id: row.discord_user_id,
      sessions: Number(row.sessions),
      active_days: Number(row.active_days),
      first_used_at: Number(row.first_used_at),
      last_used_at: Number(row.last_used_at),
    })),
    users_truncated: Number(summary?.users ?? 0) > USAGE_TOP_USERS,
  };
}
