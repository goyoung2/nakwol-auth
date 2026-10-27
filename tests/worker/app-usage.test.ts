import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { Hono } from 'hono';
import { sha256Base64Url } from '../../src/crypto';
import { readAppUsage, USAGE_TOP_USERS } from '../../src/app-usage';
import type { Env } from '../../src/types';

const textLoader = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.txt')) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}`, shortCircuit: true };
  return nextLoad(url, context);
} });
const { registerConnectRoutes } = await import('../../src/connect');
textLoader.deregister();

const DAY = 86400000;
// 2026-10-24 12:00 KST.
const NOW = Date.UTC(2026, 9, 24, 3);

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'));
  db.exec(`INSERT INTO applications VALUES('site','Site','["https://site.test/"]','active',0,0),('other','Other','["https://other.test/"]','active',0,0);
    INSERT INTO users VALUES('admin','Admin',NULL,'active',0,0),('viewer','Viewer',NULL,'active',0,0),
      ('alice','Alice','https://cdn.test/a.png','active',0,0),('bob','Bob',NULL,'active',0,0),('carol','Carol',NULL,'active',0,0);
    INSERT INTO auth_identities VALUES('i-alice','alice','discord','111111111111111111',0,0);
    INSERT INTO auth_operators VALUES('admin','operator',0,NULL);`);
  for (const user of ['admin', 'viewer']) {
    db.prepare('INSERT INTO access_tokens VALUES(?,?,?,?,NULL,0)').run(await sha256Base64Url(user), user, 'nakwol-connect-admin', Date.now() + 60000);
  }
  let sequence = 0;
  const user = (id: string) => db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,NULL,'active',0,0)").run(id, id);
  const event = (user: string | null, client: string, type: string, at: number) =>
    db.prepare('INSERT INTO auth_events VALUES(?,?,?,?,NULL,?)').run('e' + (++sequence), user, client, type, at);
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return {
      bind(...values: (string | number | null)[]) { return prepare(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args), success: true }; },
      async run() { return db.prepare(sql).run(...args); },
    };
  }
  const env = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) {
    // Like D1, run the whole batch inside one transaction and return row results.
    db.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.all()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } },
    NAKWOL_GUILD_ID: 'guild', AUTH_ORIGIN: 'https://auth.test' } as Env;
  const app = new Hono<{ Bindings: Env }>();
  registerConnectRoutes(app);
  const request = (path: string, token = '') => app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);
  return { env, event, request, user };
}

test('usage API is limited to Connect managers and validates period and app', async () => {
  const f = await fixture();
  assert.equal((await f.request('/admin/api/apps/site/usage')).status, 401);
  assert.equal((await f.request('/admin/api/apps/site/usage', 'viewer')).status, 403);
  const invalid = await f.request('/admin/api/apps/site/usage?days=365', 'admin');
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, 'INVALID_PERIOD');
  assert.equal((await f.request('/admin/api/apps/missing/usage', 'admin')).status, 404);
  const ok = await f.request('/admin/api/apps/site/usage', 'admin');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  const body = await ok.json() as { data: { days: number; daily: unknown[] } };
  assert.equal(body.data.days, 30);
  assert.equal(body.data.daily.length, 30);
});

test('usage counts sessions per user, active days in KST, and excludes other apps, old, future and non-login events', async () => {
  const f = await fixture();
  const todayKstMidnight = Date.UTC(2026, 9, 23, 15);
  // alice: 3 sessions over 2 KST days (23:30 KST yesterday and two today).
  f.event('alice', 'site', 'discord.login.success', todayKstMidnight - 30 * 60000);
  f.event('alice', 'site', 'authorize.sso_auto', todayKstMidnight + 60000);
  f.event('alice', 'site', 'authorize.sso', NOW - 60000);
  // bob: 1 session today, 1 session 10 days ago.
  f.event('bob', 'site', 'authorize.sso_auto', NOW - 2 * 60000);
  f.event('bob', 'site', 'authorize.sso_auto', NOW - 10 * DAY);
  // Excluded: other app, older than the window, non-session events, anonymous errors.
  f.event('carol', 'other', 'discord.login.success', NOW - 60000);
  f.event('carol', 'site', 'discord.login.success', NOW - 8 * DAY);
  f.event('admin', 'site', 'connect.app.updated', NOW - 60000);
  f.event(null, 'site', 'discord.login.error', NOW - 60000);
  // Written after the reported cutoff: must not leak into any query.
  f.user('dave'); f.event('dave', 'site', 'authorize.sso', NOW + 1000);
  // Denied attempts are summarized separately.
  f.event('carol', 'site', 'authorize.access_denied', NOW - 60000);
  f.event('carol', 'site', 'discord.login.access_denied', NOW - 2 * 60000);

  const week = await readAppUsage(f.env, 'site', 7, NOW);
  assert.deepEqual(week.summary, { sessions: 4, users: 2, denied: 2, denied_users: 1 });
  assert.equal(week.daily.length, 7);
  assert.deepEqual(week.daily.at(-1), { date: '2026-10-24', sessions: 3, users: 2 });
  assert.deepEqual(week.daily.at(-2), { date: '2026-10-23', sessions: 1, users: 1 });
  assert.equal(week.daily[0].date, '2026-10-18');
  assert.equal(week.since, Date.UTC(2026, 9, 17, 15));
  assert.deepEqual(week.users.map((user) => [user.user_id, user.sessions, user.active_days]), [['alice', 3, 2], ['bob', 1, 1]]);
  assert.equal(week.users[0].discord_user_id, '111111111111111111');
  assert.equal(week.users[0].avatar_url, 'https://cdn.test/a.png');
  assert.equal(week.users[0].last_used_at, NOW - 60000);
  assert.equal(week.users_truncated, false);

  const month = await readAppUsage(f.env, 'site', 30, NOW);
  assert.deepEqual(month.summary, { sessions: 6, users: 3, denied: 2, denied_users: 1 });
  assert.deepEqual(month.users.map((user) => [user.user_id, user.sessions]), [['alice', 3], ['bob', 2], ['carol', 1]]);
});

test('usage ranking is bounded and reports truncation', async () => {
  const f = await fixture();
  for (let index = 0; index <= USAGE_TOP_USERS; index++) { f.user('u' + index); f.event('u' + index, 'site', 'authorize.sso_auto', NOW - index * 1000); }
  const usage = await readAppUsage(f.env, 'site', 7, NOW);
  assert.equal(usage.summary.users, USAGE_TOP_USERS + 1);
  assert.equal(usage.users.length, USAGE_TOP_USERS);
  assert.equal(usage.users_truncated, true);
});

test('failure statistics separate refresh, denial, errors and subsequent same-app recovery without editing events', async () => {
  const f = await fixture();
  const refresh = NOW - 60000;
  // event() stores null details by default; set a historical refresh reason through the same SQLite adapter.
  f.event('alice','site','authorize.access_denied',refresh);
  await f.env.DB.prepare(`UPDATE auth_events SET detail=? WHERE user_id='alice'`).bind(JSON.stringify({diagnosis:{reason:'MEMBERSHIP_REFRESH_REQUIRED'}})).run();
  f.event('alice','site','discord.login.success',NOW-30000);
  f.event('bob','site','discord.login.access_denied',refresh);
  f.event('bob','other','discord.login.success',NOW-30000);
  f.event(null,'site','discord.login.error',refresh);
  f.event('carol','site','authorize.access_denied',refresh);
  await f.env.DB.prepare(`UPDATE auth_events SET detail=? WHERE user_id='carol'`).bind(JSON.stringify({diagnosis:{reason:'REAUTHENTICATION_REQUIRED'}})).run();
  f.event('carol','site','discord.login.success',NOW+1000);
  const usage = await readAppUsage(f.env,'site',7,NOW);
  assert.deepEqual(usage.failure_summary,{refresh_required:2,access_denied:1,authentication_errors:1,recovered_users:1,unresolved_users:2});
  assert.equal(usage.summary.denied,3);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM auth_events').first<{n:number}>())?.n,7);
});
