import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}`;

function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer token');
  headers.set('X-NAKWOL-CLIENT-ID', 'deck-lab');
  headers.set('Origin', 'https://deck-lab.pages.dev');
  return new Request(`https://data.example${path}`, { ...init, headers });
}

function grant(DB: any, scope: string) {
  const now = Date.now();
  DB.raw.prepare('INSERT OR IGNORE INTO data_applications(client_id,status,created_at,updated_at) VALUES (?,?,?,?)').run('deck-lab', 'active', now, now);
  DB.raw.prepare('INSERT OR IGNORE INTO data_application_scopes(client_id,scope,created_at) VALUES (?,?,?)').run('deck-lab', scope, now);
}

function seedUser(DB: any, userId: string) {
  const now = Date.now();
  DB.raw.prepare('INSERT OR IGNORE INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run(userId, now, now);
}

function seedAccount(DB: any, accountId: string, userId = 'usr_abc') {
  seedUser(DB, userId);
  const now = Date.now();
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run(accountId, userId, `${userId}-nick`, '5', now, now);
}

function seedTactic(DB: any, tacticId: string, name: string, options: { enabled?: number; chip?: number; class?: number; learn?: number; get?: number; copy?: number } = {}) {
  const metadata = {
    class: options.class ?? 5,
    learn: options.learn ?? 1,
    get: options.get ?? 3,
    copy: options.copy ?? 0,
    chip: options.chip ?? 1020010,
    special: 0,
  };
  DB.raw.prepare('INSERT INTO game_tactics(id,name,category,rarity,enabled,metadata_json) VALUES (?,?,?,?,?,?)')
    .run(tacticId, name, '지휘', 3, options.enabled ?? 1, JSON.stringify(metadata));
}

function seedUniqueGeneral(DB: any, generalId: string, tacticId: string) {
  DB.raw.prepare("INSERT INTO game_generals(id,name,unique_tactic_id,enabled,metadata_json) VALUES (?,?,?,1,'{}')").run(generalId, '고유장수', tacticId);
}

function authFetcher(userId = 'usr_abc') {
  return async () => Response.json({ ok: true, data: { id: userId, display_name: userId, avatar_url: null, membership: { role: 'member' } } });
}

async function call(request: Request, env: any, userId = 'usr_abc') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = authFetcher(userId) as typeof fetch;
  try {
    return await (app as any).fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('owned tactics routes are real authenticated endpoints', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  const response = await (app as any).fetch(new Request('https://data.example/v1/game-accounts/gac_a/roster/tactics'), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 401);
  const body = await response.json() as any;
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('owned tactics list is scope-protected and account-owner isolated', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedTactic(DB, 't:20010', '문무겸비');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_tactics(account_id,tactic_id,breakthrough,favorite,note,updated_at) VALUES (?,?,?,?,?,?)').run('gac_a', 't:20010', 4, 1, '핵심', now);

  let response = await call(req('/v1/game-accounts/gac_a/roster/tactics'), env);
  assert.equal(response.status, 403);
  grant(DB, 'roster:read');

  response = await call(req('/v1/game-accounts/gac_a/roster/tactics'), env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.data, [{
    tactic_id: 't:20010',
    name: '문무겸비',
    breakthrough: 4,
    favorite: true,
    note: '핵심',
    updated_at: now,
  }]);

  response = await call(req('/v1/game-accounts/gac_other/roster/tactics'), env);
  assert.equal(response.status, 404);
  const foreignBody = await response.json() as any;
  assert.equal(foreignBody.error.code, 'GAME_ACCOUNT_NOT_FOUND');
});

test('owned tactic PUT validates and idempotently upserts only canonical chip-linked tactics', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedTactic(DB, 't:20010', '문무겸비', { chip: 1020010 });
  seedTactic(DB, 't:17703', '결사의 다짐 이벤트', { chip: 0 });
  seedTactic(DB, 't:hidden', '숨김', { enabled: 0, chip: 123 });
  seedTactic(DB, 't:unique', '고유전법', { chip: 999 });
  seedUniqueGeneral(DB, 'general:unique-owner', 't:unique');
  grant(DB, 'roster:write');

  let response = await call(req('/v1/game-accounts/gac_a/roster/tactics/t%3A20010', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakthrough: 3, favorite: true, note: ' 주력 ' }),
  }), env);
  assert.equal(response.status, 200);
  let body = await response.json() as any;
  assert.equal(body.data.tactic_id, 't:20010');
  assert.equal(body.data.name, '문무겸비');
  assert.equal(body.data.breakthrough, 3);
  assert.equal(body.data.favorite, true);
  assert.equal(body.data.note, '주력');

  response = await call(req('/v1/game-accounts/gac_a/roster/tactics/t%3A20010', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakthrough: 5, favorite: false, note: null }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_tactics WHERE account_id=? AND tactic_id=?').get('gac_a', 't:20010').n, 1);
  assert.equal(DB.raw.prepare('SELECT breakthrough FROM user_tactics WHERE account_id=? AND tactic_id=?').get('gac_a', 't:20010').breakthrough, 5);

  response = await call(req('/v1/game-accounts/gac_a/roster/tactics/t%3A20010', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ breakthrough: 6 }),
  }), env);
  assert.equal(response.status, 400);
  body = await response.json() as any;
  assert.equal(body.error.code, 'INVALID_BREAKTHROUGH');

  for (const id of ['t:17703', 't:hidden', 't:unique']) {
    response = await call(req(`/v1/game-accounts/gac_a/roster/tactics/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ breakthrough: 0 }),
    }), env);
    assert.equal(response.status, 404, id);
    body = await response.json() as any;
    assert.equal(body.error.code, 'TACTIC_NOT_FOUND', id);
  }
});

test('owned tactic DELETE removes the account asset and remains owner isolated', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedTactic(DB, 't:20010', '문무겸비');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_tactics(account_id,tactic_id,updated_at) VALUES (?,?,?)').run('gac_a', 't:20010', now);
  grant(DB, 'roster:write');

  let response = await call(req('/v1/game-accounts/gac_other/roster/tactics/t%3A20010', { method: 'DELETE' }), env);
  assert.equal(response.status, 404);

  response = await call(req('/v1/game-accounts/gac_a/roster/tactics/t%3A20010', { method: 'DELETE' }), env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.data, { deleted: true, tactic_id: 't:20010' });
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_tactics WHERE account_id=?').get('gac_a').n, 0);
});
