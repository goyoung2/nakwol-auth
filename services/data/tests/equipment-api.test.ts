import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0003_equipment_options_v08.sql', import.meta.url), 'utf8')}`;

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

function seedTemplate(DB: any, templateId: string, name: string, type: 'weapon'|'mount', enabled = 1) {
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES (?,?,?,?, '{}')").run(templateId, type, name, enabled);
}

function seedTrait(DB: any, id: string, nativeId: number, kind: 'skill'|'effect', name: string, evidence: 'canonical'|'observed'|'unresolved' = 'canonical', enabled = 1) {
  DB.raw.prepare("INSERT INTO game_equipment_traits(id,name,equipment_type,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES (?,?,NULL,?,?, '{}',?,?,?)")
    .run(id, name, `${name} 설명`, enabled, nativeId, kind, evidence);
}

function seedApplicability(DB: any, traitId: string, type: 'weapon'|'mount', evidence: 'canonical'|'observed'|'unresolved' = 'canonical') {
  DB.raw.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES (?,?,?,'test:authority','{}')")
    .run(traitId, type, evidence);
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

test('equipment routes are real authenticated endpoints', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  const response = await (app as any).fetch(new Request('https://data.example/v1/game-accounts/gac_a/equipment'), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 401);
  const body = await response.json() as any;
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('equipment list is scope-protected, owner isolated, and includes frozen Registry display for current traits', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedTemplate(DB, 'w:1', '청룡검', 'weapon');
  seedTrait(DB, 'ets:56', 56, 'skill', '구주');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('eqp_one', 'gac_a', 'w:1', '주력검', 1, 1, now, now);
  DB.raw.prepare("INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES ('eqp_one',1,'ets:56')").run();

  let response = await call(req('/v1/game-accounts/gac_a/equipment'), env);
  assert.equal(response.status, 403);
  grant(DB, 'equipment:read');

  response = await call(req('/v1/game-accounts/gac_a/equipment'), env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.data, [{
    id: 'eqp_one', template_id: 'w:1', template_name: '청룡검', type: 'weapon', nickname: '주력검', locked: true, favorite: true, created_at: now, updated_at: now,
    traits: [{ slot: 1, trait_id: 'ets:56', kind: 'skill', name: '구주', description: '구주 설명' }],
  }]);

  response = await call(req('/v1/game-accounts/gac_other/equipment'), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'GAME_ACCOUNT_NOT_FOUND');
});

test('equipment POST persists only canonical traits with canonical matching type applicability while stats remain blocked', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedTemplate(DB, 'w:1', '청룡검', 'weapon');
  seedTemplate(DB, 'm:1', '적토마', 'mount');
  seedTemplate(DB, 'w:hidden', '숨김무기', 'weapon', 0);
  seedTrait(DB, 'ets:56', 56, 'skill', '구주');
  seedTrait(DB, 'ete:54', 54, 'effect', '투영');
  seedTrait(DB, 'ets:observed', 9001, 'skill', '관측특기', 'observed');
  seedTrait(DB, 'ets:hidden', 9002, 'skill', '숨김특기', 'canonical', 0);
  seedApplicability(DB, 'ets:56', 'weapon', 'canonical');
  seedApplicability(DB, 'ete:54', 'mount', 'canonical');
  seedApplicability(DB, 'ets:observed', 'weapon', 'canonical');
  grant(DB, 'equipment:write');

  let response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', nickname: ' 주력검 ', locked: true, traits: [{ slot: 1, trait_id: 'ets:56' }, { slot: 2, trait_id: 'ets:56' }] }),
  }), env);
  assert.equal(response.status, 201);
  let body = await response.json() as any;
  assert.match(body.data.id, /^eqp_[A-Za-z0-9_-]{12,}$/);
  assert.equal(body.data.template_id, 'w:1');
  assert.equal(body.data.type, 'weapon');
  assert.deepEqual(body.data.traits, [
    { slot: 1, trait_id: 'ets:56', kind: 'skill', name: '구주', description: '구주 설명' },
    { slot: 2, trait_id: 'ets:56', kind: 'skill', name: '구주', description: '구주 설명' },
  ]);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_equipment_traits WHERE equipment_id=?').get(body.data.id).n, 2);

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:hidden' }),
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TEMPLATE_NOT_FOUND');

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', stats: [{ slot: 1, stat_type_id: 's:1', value: 1 }] }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_OPTIONS_UNSUPPORTED');

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', traits: [{ slot: 1, trait_id: 'ets:missing' }] }),
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TRAIT_NOT_FOUND');

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', traits: [{ slot: 1, trait_id: 'ets:hidden' }] }),
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TRAIT_NOT_FOUND');

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', traits: [{ slot: 1, trait_id: 'ets:observed' }] }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TRAIT_UNVERIFIED');

  response = await call(req('/v1/game-accounts/gac_a/equipment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:1', traits: [{ slot: 1, trait_id: 'ete:54' }] }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE');
});

test('equipment PATCH replaces traits atomically, omission preserves them, and empty traits clears them', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedTemplate(DB, 'w:1', '청룡검', 'weapon');
  seedTemplate(DB, 'w:2', '의천검', 'weapon');
  seedTrait(DB, 'ets:56', 56, 'skill', '구주');
  seedTrait(DB, 'ete:54', 54, 'effect', '투영');
  seedApplicability(DB, 'ets:56', 'weapon', 'canonical');
  seedApplicability(DB, 'ete:54', 'weapon', 'canonical');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('eqp_one', 'gac_a', 'w:1', null, 0, 0, now, now);
  DB.raw.prepare("INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES ('eqp_one',1,'ets:56')").run();
  grant(DB, 'equipment:write');

  let response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: ' 애장품 ', locked: true, favorite: true }),
  }), env);
  assert.equal(response.status, 200);
  let body = await response.json() as any;
  assert.equal(body.data.nickname, '애장품');
  assert.deepEqual(body.data.traits, [{ slot: 1, trait_id: 'ets:56', kind: 'skill', name: '구주', description: '구주 설명' }]);
  assert.equal(DB.raw.prepare("SELECT trait_id FROM user_equipment_traits WHERE equipment_id='eqp_one' AND slot=1").get().trait_id, 'ets:56');

  response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ traits: [{ slot: 1, trait_id: 'ete:54' }, { slot: 2, trait_id: 'ets:missing' }] }),
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TRAIT_NOT_FOUND');
  assert.deepEqual(DB.raw.prepare("SELECT slot,trait_id FROM user_equipment_traits WHERE equipment_id='eqp_one' ORDER BY slot").all().map((row:any)=>[row.slot,row.trait_id]), [[1,'ets:56']]);

  response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ traits: [{ slot: 1, trait_id: 'ete:54' }, { slot: 2, trait_id: 'ets:56' }] }),
  }), env);
  assert.equal(response.status, 200);
  body = await response.json() as any;
  assert.deepEqual(body.data.traits.map((row:any)=>[row.slot,row.trait_id]), [[1,'ete:54'],[2,'ets:56']]);

  response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ traits: [] }),
  }), env);
  assert.equal(response.status, 200);
  body = await response.json() as any;
  assert.deepEqual(body.data.traits, []);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM user_equipment_traits WHERE equipment_id='eqp_one'").get().n, 0);

  response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: 'w:2' }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_TEMPLATE_IMMUTABLE');

  response = await call(req('/v1/game-accounts/gac_other/equipment/eqp_one', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: false }),
  }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as any).error.code, 'EQUIPMENT_NOT_FOUND');
});

test('equipment DELETE removes only owned account instances and cascades trait rows', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example' } as any;
  seedAccount(DB, 'gac_a');
  seedAccount(DB, 'gac_other', 'usr_other');
  seedTemplate(DB, 'm:1', '적토마', 'mount');
  seedTrait(DB, 'ets:56', 56, 'skill', '구주');
  const now = Date.now();
  DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,created_at,updated_at) VALUES (?,?,?,?,?)').run('eqp_mount', 'gac_a', 'm:1', now, now);
  DB.raw.prepare("INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES ('eqp_mount',1,'ets:56')").run();
  grant(DB, 'equipment:write');

  let response = await call(req('/v1/game-accounts/gac_other/equipment/eqp_mount', { method: 'DELETE' }), env);
  assert.equal(response.status, 404);

  response = await call(req('/v1/game-accounts/gac_a/equipment/eqp_mount', { method: 'DELETE' }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).data, { deleted: true, id: 'eqp_mount' });
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_equipment WHERE id=?').get('eqp_mount').n, 0);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_equipment_traits WHERE equipment_id=?').get('eqp_mount').n, 0);
});
