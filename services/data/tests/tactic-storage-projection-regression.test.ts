import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}`;

function authFetcher() {
  return async () => Response.json({ ok:true, data:{ id:'usr_projection', display_name:'projection', avatar_url:null, membership:{ role:'member' } } });
}

async function call(request: Request, env: any) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = authFetcher() as typeof fetch;
  try {
    return await (app as any).fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('owned tactic PUT accepts the Registry metadata projection used by production seed', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN:'https://auth.example' } as any;
  const now = Date.now();

  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_projection', now, now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run('gac_projection', 'usr_projection', 'projection', 'lab', now, now);
  DB.raw.prepare('INSERT INTO data_applications(client_id,status,created_at,updated_at) VALUES (?,?,?,?)').run('projection-lab', 'active', now, now);
  DB.raw.prepare('INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES (?,?,?)').run('projection-lab', 'roster:write', now);

  const productionMetadata = {
    native_id: 20010,
    source_domain: 'skills',
    skill_class_raw: 5,
    skill_type_raw: 1,
    special_type_raw: 0,
    chip_id: 1020010,
    learn_times: 1,
    get_type: 3,
    is_copy: 0,
    ownership_status: 'unclassified',
  };
  DB.raw.prepare('INSERT INTO game_tactics(id,name,category,rarity,enabled,metadata_json) VALUES (?,?,?,?,1,?)')
    .run('t:20010', '문무겸비', '지휘', 3, JSON.stringify(productionMetadata));

  const response = await call(new Request('https://data.example/v1/game-accounts/gac_projection/roster/tactics/t%3A20010', {
    method:'PUT',
    headers:{
      Authorization:'Bearer token',
      'X-NAKWOL-CLIENT-ID':'projection-lab',
      Origin:'https://projection-lab.pages.dev',
      'Content-Type':'application/json',
    },
    body:JSON.stringify({ breakthrough:1, favorite:true, note:'production projection' }),
  }), env);

  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.data.tactic_id, 't:20010');
  assert.equal(body.data.name, '문무겸비');
  assert.equal(body.data.breakthrough, 1);
  assert.equal(body.data.favorite, true);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_tactics WHERE account_id=? AND tactic_id=?').get('gac_projection', 't:20010').n, 1);
});
