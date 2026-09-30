import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as miniflare from 'miniflare';
import app from '../../src/index';
import { saveDiscordCredentials, deleteDiscordCredentials } from '../../src/discord-credentials';
import { ensureFreshMembership } from '../../src/membership-refresh';
import { evaluateAccess } from '../../src/policy';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

const guild = '1493410906456064112';
const season = '1553600098661957643';

test('central OAuth renewal rotates tokens, handles errors and fences role evidence in real D1', async t => {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql',
    '0013_access_support.sql', '0015_auth_policy_settings.sql', '0016_server_sessions.sql', '0017_discord_credentials.sql']) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) await DB.prepare(statement).run();
  }
  const env: Env = { DB, NAKWOL_GUILD_ID: guild, NAKWOL_MEMBER_ROLE_ID: season, AUTH_ORIGIN: 'https://auth.test',
    DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture', DISCORD_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    DISCORD_CREDENTIAL_KEY_VERSION: '2', DISCORD_CREDENTIAL_PREVIOUS_KEY: randomBytes(32).toString('base64'),
    DISCORD_CREDENTIAL_PREVIOUS_VERSION: '1', DISCORD_CREDENTIAL_PREVIOUS_UNTIL: String(Date.now() + 60000) };
  await DB.prepare("INSERT INTO users VALUES ('u','Tester',NULL,'active',0,0)").run();
  await DB.prepare("INSERT INTO auth_identities VALUES ('i','u','discord','1493410906456064113',0,0)").run();
  await DB.prepare("INSERT INTO applications VALUES ('site','Site','[\"https://site.test/\"]','active',0,0)").run();
  await DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('site','member',0,0)").run();
  await DB.prepare('INSERT INTO memberships VALUES (?,?,?,?,?,?,?)')
    .bind('u', guild, 1, 'member', 'active', Date.now() - 16 * 60000, JSON.stringify([season])).run();
  await DB.prepare('INSERT INTO access_tokens VALUES (?,?,?,?,?,?)')
    .bind(await sha256Base64Url('site-token'), 'u', 'site', Date.now() + 60000, null, Date.now()).run();
  await saveDiscordCredentials(env, 'u', { accessToken: 'private-access', refreshToken: 'private-refresh', scope: 'identify guilds.members.read', expiresIn: 1 });
  await DB.prepare('UPDATE discord_credentials SET access_expires_at=0 WHERE user_id=?').bind('u').run();
  const stored = await DB.prepare('SELECT access_ciphertext,refresh_ciphertext FROM discord_credentials WHERE user_id=?')
    .bind('u').first<{ access_ciphertext: string; refresh_ciphertext: string }>();
  assert.ok(stored && !JSON.stringify(stored).includes('private-access') && !JSON.stringify(stored).includes('private-refresh'));

  let mode: 'member' | 'removed' | 'left' | 'rate' | 'error' | 'guild_error' | 'invalid' | 'expired_once' | 'bad_token' = 'member';
  let refreshCalls = 0;
  let memberCalls = 0;
  let accessExpiredOnce = false;
  let memberGate: Promise<void> | null = null;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) {
      refreshCalls += 1;
      if (mode === 'invalid') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (mode === 'rate') return Response.json({}, { status: 429, headers: { 'Retry-After': '3' } });
      if (mode === 'error') return Response.json({}, { status: 503 });
      if (mode === 'bad_token') return new Response('{broken', { status: 200 });
      return Response.json({ access_token: `new-access-${refreshCalls}`, refresh_token: `new-refresh-${refreshCalls}`,
        scope: 'identify guilds.members.read', expires_in: 3600 });
    }
    if (url.includes('/users/@me/guilds/')) {
      memberCalls += 1;
      if (memberGate) await memberGate;
      if (mode === 'rate') return Response.json({}, { status: 429, headers: { 'Retry-After': '3' } });
      if (mode === 'error' || mode === 'guild_error') return Response.json({}, { status: 503 });
      if (mode === 'expired_once' && !accessExpiredOnce) {
        accessExpiredOnce = true;
        return Response.json({}, { status: 401 });
      }
      if (mode === 'left') return Response.json({}, { status: 404 });
      return Response.json({ roles: mode === 'removed' ? [] : [season] });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const first = await ensureFreshMembership(env, 'u', { force: true });
  assert.equal(first.kind, 'fresh');
  assert.equal(refreshCalls, 1);
  assert.equal((await evaluateAccess(env, 'u', 'site')).allowed, true);
  const response = await app.request('https://auth.test/me?client_id=site', { headers: { Authorization: 'Bearer site-token' } }, env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.authorization_policy.authorizationEvidenceValidUntil <= first.validUntil);

  mode = 'removed';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh');
  assert.equal((await evaluateAccess(env, 'u', 'site')).reason, 'SEASON_ROLE_MISSING');
  mode = 'left';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh');
  assert.equal((await DB.prepare('SELECT is_guild_member FROM memberships WHERE user_id=?').bind('u').first<{is_guild_member:number}>())?.is_guild_member, 0);
  mode = 'member';
  await ensureFreshMembership(env, 'u', { force: true });

  let releaseMember = () => {};
  memberGate = new Promise<void>(resolve => { releaseMember = resolve; });
  await DB.prepare('UPDATE discord_credentials SET access_expires_at=0 WHERE user_id=?').bind('u').run();
  const isolated = (): Env => ({ ...env, DB: new Proxy(DB, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) });
  const beforeConcurrent = memberCalls;
  const beforeConcurrentRefresh = refreshCalls;
  const firstApplication = ensureFreshMembership(isolated(), 'u', { force: true });
  while (memberCalls === beforeConcurrent) await new Promise(resolve => setTimeout(resolve, 10));
  const secondApplication = ensureFreshMembership(isolated(), 'u', { force: true });
  await new Promise(resolve => setTimeout(resolve, 1000));
  releaseMember();
  const concurrent = await Promise.all([firstApplication, secondApplication]);
  assert.deepEqual(concurrent.map(result => result.kind), ['fresh', 'fresh']);
  assert.equal(memberCalls, beforeConcurrent + 1, 'separate environments share one D1 lease');
  assert.equal(refreshCalls, beforeConcurrentRefresh + 1, 'rotating refresh token is consumed once across bindings');
  memberGate = null;

  await DB.prepare('UPDATE discord_credentials SET access_expires_at=0 WHERE user_id=?').bind('u').run();
  mode = 'guild_error';
  const beforeRotationError = refreshCalls;
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'unavailable');
  assert.equal(refreshCalls, beforeRotationError + 1);
  const afterRotationError = await DB.prepare('SELECT generation,refresh_ciphertext FROM discord_credentials WHERE user_id=?')
    .bind('u').first<{generation:number;refresh_ciphertext:string}>();
  assert.ok(afterRotationError && afterRotationError.generation > 1 && afterRotationError.refresh_ciphertext !== stored.refresh_ciphertext);
  await DB.prepare('UPDATE discord_credentials SET retry_after=NULL WHERE user_id=?').bind('u').run();
  mode = 'member';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh', 'rotated token survives failed guild lookup');

  mode = 'expired_once';
  accessExpiredOnce = false;
  const beforeExpiredRefresh = refreshCalls;
  const beforeExpiredMember = memberCalls;
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh');
  assert.equal(refreshCalls, beforeExpiredRefresh + 1, 'guild 401 refreshes once under the lease');
  assert.equal(memberCalls, beforeExpiredMember + 2, 'guild lookup retries only once');

  mode = 'rate';
  const rate = await ensureFreshMembership(env, 'u', { force: true });
  assert.equal(rate.kind, 'unavailable');
  assert.ok(rate.retryAfter && rate.retryAfter > Date.now() + 2500);
  assert.equal((await DB.prepare('SELECT role FROM memberships WHERE user_id=?').bind('u').first<{role:string}>())?.role, 'member');
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'unavailable');
  await DB.prepare('UPDATE memberships SET checked_at=? WHERE user_id=?').bind(Date.now() - 16 * 60000, 'u').run();
  const unavailable = await app.request('https://auth.test/me?client_id=site', { headers: { Authorization: 'Bearer site-token' } }, env);
  assert.equal(unavailable.status, 503, 'hard expired proof fails closed during upstream outage');
  await DB.prepare('UPDATE memberships SET checked_at=? WHERE user_id=?').bind(Date.now(), 'u').run();
  await DB.prepare('UPDATE discord_credentials SET retry_after=NULL WHERE user_id=?').bind('u').run();
  mode = 'error';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'unavailable');
  await DB.prepare('UPDATE discord_credentials SET retry_after=NULL,access_expires_at=0 WHERE user_id=?').bind('u').run();
  mode = 'bad_token';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'unavailable', 'truncated token JSON is transient');
  assert.equal((await DB.prepare('SELECT state FROM discord_credentials WHERE user_id=?').bind('u').first<{state:string}>())?.state, 'active');
  await DB.prepare('UPDATE discord_credentials SET retry_after=NULL WHERE user_id=?').bind('u').run();
  const oldKey = env.DISCORD_CREDENTIAL_KEY;
  env.DISCORD_CREDENTIAL_PREVIOUS_KEY = oldKey;
  env.DISCORD_CREDENTIAL_PREVIOUS_VERSION = '2';
  env.DISCORD_CREDENTIAL_PREVIOUS_UNTIL = String(Date.now() + 60000);
  env.DISCORD_CREDENTIAL_KEY = randomBytes(32).toString('base64');
  env.DISCORD_CREDENTIAL_KEY_VERSION = '3';
  mode = 'member';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh');
  assert.equal((await DB.prepare('SELECT key_version FROM discord_credentials WHERE user_id=?').bind('u').first<{key_version:number}>())?.key_version, 3);
  env.DISCORD_CREDENTIAL_PREVIOUS_UNTIL = String(Date.now() - 1);
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'fresh', 'rotated record no longer needs previous key');
  await DB.prepare('UPDATE discord_credentials SET access_expires_at=0 WHERE user_id=?').bind('u').run();
  mode = 'invalid';
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'reauth-required');
  assert.equal((await evaluateAccess(env, 'u', 'site')).allowed, false);
  await deleteDiscordCredentials(env, 'u');
  assert.equal((await ensureFreshMembership(env, 'u')).kind, 'reauth-required');
  await DB.prepare('DELETE FROM discord_credentials WHERE user_id=?').bind('u').run();
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'reauth-required');
  await DB.prepare('UPDATE membership_refresh_policy SET legacy_deadline_at=? WHERE id=1').bind(Date.now() - 1).run();
  assert.equal((await ensureFreshMembership(env, 'u')).kind, 'reauth-required');
  const noCredentialFetches = memberCalls;
  await DB.prepare(`INSERT INTO user_reauthentication(user_id,requested_at,requested_by,reason)
    VALUES ('u',?,?,?)`).bind(Date.now(), 'u', 'manual verification').run();
  assert.equal((await ensureFreshMembership(env, 'u', { force: true })).kind, 'reauth-required');
  assert.equal(memberCalls, noCredentialFetches, 'force never clears an explicit interactive reauthentication request');
  assert.ok(memberCalls >= 4);
});
