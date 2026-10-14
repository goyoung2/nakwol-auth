import { migrationStatements } from './migration-statements';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import auth from '../../src/index';
import { sha256Base64Url } from '../../src/crypto';
import { MEMBERSHIP_MAX_AGE_MS } from '../../src/policy';
import { createAuthorizationCode, exchangeAuthorizationCode } from '../../src/store';

test('stale membership remains denied but can recover without a false role denial', async t => {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, migrations), 'utf8');
    for (const statement of migrationStatements(sql)) await DB.prepare(statement).run();
  }
  const queries: string[] = [];
  const trackedDB = new Proxy(DB, { get(target, key, receiver) {
    if (key === 'prepare') return (sql: string) => { queries.push(sql); return target.prepare(sql); };
    return Reflect.get(target, key, receiver);
  } });
  const env = { DB: trackedDB, NAKWOL_GUILD_ID: '1493410906456064112', NAKWOL_MEMBER_ROLE_ID: '1553600098661957643', AUTH_ORIGIN: 'https://auth.test', DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture' };
  const now = Date.now();
  await DB.prepare("INSERT INTO applications VALUES('site','site',?,'active',0,0)").bind(JSON.stringify(['https://site.test/'])).run();
  await DB.prepare("INSERT INTO users VALUES('user','user',NULL,'active',0,0)").run();
  await DB.prepare("INSERT INTO memberships(user_id,guild_id,is_guild_member,role,status,checked_at,role_ids) VALUES('user',?,1,'member','active',?,?)")
    .bind(env.NAKWOL_GUILD_ID, now - MEMBERSHIP_MAX_AGE_MS - 1, JSON.stringify([env.NAKWOL_MEMBER_ROLE_ID])).run();
  await DB.prepare("INSERT INTO access_tokens VALUES(?,'user','site',?,NULL,?)").bind(await sha256Base64Url('token'), now + 600000, now).run();
  await DB.prepare("INSERT INTO auth_sessions VALUES(?,'user',?,?,?)").bind(await sha256Base64Url('session'), now + 600000, now, now).run();
  const authorize = (silent: boolean) => auth.request('https://auth.test/authorize?' + new URLSearchParams({
    client_id: 'site', redirect_uri: 'https://site.test/', code_challenge: 'challenge', code_challenge_method: 'S256', state: 'state', ...(silent ? { prompt: 'none' } : {}),
  }), { headers: { Cookie: 'nakwol_sid=session' } }, env);
  const me = (origin = 'https://site.test', token = 'token') => auth.request('https://auth.test/me?client_id=site', { headers: { Origin: origin, Authorization: 'Bearer ' + token } }, env);

  await t.test('silent stale SSO returns login_required, issues no code, preserves central session', async () => {
    const response = await authorize(true);
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get('Location') ?? '').searchParams.get('error'), 'login_required');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{n: number}>())?.n, 1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_codes').first<{n: number}>())?.n, 0);
  });
  await t.test('stale /me is unauthenticated, carries CORS and no-store, exposes no user', async () => {
    const response = await me();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://site.test');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const payload: {error: {code: string}; data?: unknown} = await response.json();
    assert.equal(payload.error.code, 'MEMBERSHIP_REFRESH_REQUIRED');
    assert.equal(payload.data, undefined);
  });
  await t.test('explicit retry still opens Discord; it cannot authorize a stale snapshot', async () => {
    const response = await authorize(false);
    assert.equal(new URL(response.headers.get('Location') ?? '').hostname, 'discord.com');
  });
  await DB.prepare("UPDATE memberships SET checked_at=? WHERE user_id='user'").bind(Date.now()).run();
  await t.test('fresh member /me uses at most three database round trips', async () => {
    queries.length = 0;
    const response = await me();
    assert.equal(response.status, 200);
    const payload: {data: {id: string}} = await response.json();
    assert.equal(payload.data.id, 'user');
    assert.equal(queries.filter(q => q.includes('FROM applications')).length, 1);
    assert.ok(queries.length <= 3, 'authorization must not fan out into independent remote reads');
  });
  await t.test('concurrent redemption issues exactly one token per authorization code', async () => {
    const code=await createAuthorizationCode(env,'user','site','https://site.test/',await sha256Base64Url('verifier'));
    const before=await DB.prepare('SELECT COUNT(*) AS n FROM access_tokens').first<{n:number}>();
    const redeem=()=>exchangeAuthorizationCode(env,{code,clientId:'site',redirectUri:'https://site.test/',codeVerifier:'verifier'});
    const outcomes=await Promise.allSettled([redeem(),redeem(),redeem()]);
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    const after=await DB.prepare('SELECT COUNT(*) AS n FROM access_tokens').first<{n:number}>();
    assert.equal(Number(after?.n)-Number(before?.n),1);
    await assert.rejects(redeem(),/INVALID_OR_EXPIRED_CODE/);
  });
  await t.test('unregistered origin and wrong token stay denied', async () => {
    assert.equal((await me('https://evil.test')).status, 403);
    assert.equal((await me('https://site.test', 'invalid')).status, 401);
  });
  await DB.prepare("INSERT OR REPLACE INTO auth_sessions VALUES(?,'user',?,?,?)").bind(await sha256Base64Url('session'), now + 600000, now, now).run();
  await DB.prepare("UPDATE memberships SET role_ids='[]',role='user',status='inactive' WHERE user_id='user'").run();
  await t.test('fresh missing role remains actual denial and invalidates silent SSO', async () => {
    assert.equal((await me()).status, 403);
    const response = await authorize(true);
    assert.equal(new URL(response.headers.get('Location') ?? '').searchParams.get('error'), 'access_denied');
    assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{n: number}>())?.n, 0);
  });
});
