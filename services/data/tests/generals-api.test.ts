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

function seedGeneral(DB: any, generalId: string, name: string, enabled = 1) {
  DB.raw.prepare("INSERT INTO game_generals(id,name,enabled,metadata_json) VALUES (?,?,?, '{}')").run(generalId, name, enabled);
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

test('owned generals routes are real authenticated endpoints', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  const response = await (app as any).fetch(new Request('https://data.example/v1/game-accounts/gac_a/roster/generals'), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 401);
  const body = await response.json() as any;
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('owned generals list is scope-protected and account-owner isolated', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedGeneral(DB, 'general:1', '조조');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_generals(account_id,general_id,breakthrough,promotion,favorite,note,updated_at) VALUES (?,?,?,?,?,?,?)').run('gac_a', 'general:1', 3, 4, 1, '주력', now);

  let response = await call(req('/v1/game-accounts/gac_a/roster/generals'), env);
  assert.equal(response.status, 403);
  grant(DB, 'roster:read');

  response = await call(req('/v1/game-accounts/gac_a/roster/generals'), env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.data.length, 1);
  assert.deepEqual(body.data[0], {
    general_id: 'general:1',
    name: '조조',
    breakthrough: 3,
    promotion: 4,
    favorite: true,
    note: '주력',
    updated_at: now,
  });

  response = await call(req('/v1/game-accounts/gac_other/roster/generals'), env);
  assert.equal(response.status, 404);
  const foreignBody = await response.json() as any;
  assert.equal(foreignBody.error.code, 'GAME_ACCOUNT_NOT_FOUND');
});

test('owned general PUT validates and idempotently upserts playable registry generals', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedGeneral(DB, 'general:1', '조조');
  seedGeneral(DB, 'general:hidden', '숨김', 0);
  grant(DB, 'roster:write');

  let response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3A1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakthrough: 3, promotion: 4, favorite: true, note: ' 주력 ' }),
  }), env);
  assert.equal(response.status, 200);
  let body = await response.json() as any;
  assert.equal(body.data.general_id, 'general:1');
  assert.equal(body.data.breakthrough, 3);
  assert.equal(body.data.promotion, 4);
  assert.equal(body.data.favorite, true);
  assert.equal(body.data.note, '주력');

  response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3A1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakthrough: 5, promotion: 7, favorite: false, note: null }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_generals WHERE account_id=? AND general_id=?').get('gac_a', 'general:1').n, 1);
  assert.equal(DB.raw.prepare('SELECT breakthrough FROM user_generals WHERE account_id=? AND general_id=?').get('gac_a', 'general:1').breakthrough, 5);

  response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3A1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ breakthrough: 6, promotion: 0 }),
  }), env);
  assert.equal(response.status, 400);
  body = await response.json() as any;
  assert.equal(body.error.code, 'INVALID_BREAKTHROUGH');

  response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3A1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ breakthrough: 1, promotion: -1 }),
  }), env);
  assert.equal(response.status, 400);
  body = await response.json() as any;
  assert.equal(body.error.code, 'INVALID_PROMOTION');

  response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3Ahidden', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ breakthrough: 0, promotion: 0 }),
  }), env);
  assert.equal(response.status, 404);
  body = await response.json() as any;
  assert.equal(body.error.code, 'GENERAL_NOT_FOUND');
});

test('owned general DELETE removes the account asset and remains owner isolated', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedGeneral(DB, 'general:1', '조조');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_generals(account_id,general_id,updated_at) VALUES (?,?,?)').run('gac_a', 'general:1', now);
  grant(DB, 'roster:write');

  let response = await call(req('/v1/game-accounts/gac_other/roster/generals/general%3A1', { method: 'DELETE' }), env);
  assert.equal(response.status, 404);

  response = await call(req('/v1/game-accounts/gac_a/roster/generals/general%3A1', { method: 'DELETE' }), env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.data, { deleted: true, general_id: 'general:1' });
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_generals WHERE account_id=?').get('gac_a').n, 0);
});
