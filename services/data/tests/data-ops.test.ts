import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { buildDataOpenApi } from '../src/openapi.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const migration = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const ctx = { waitUntil() {}, passThroughOnException() {} };
const source = (path:string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

function opsReq(path:string, clientId='nakwol-data-ops') {
  return new Request(`https://data.example${path}`, { headers:{ Authorization:'Bearer token', 'X-NAKWOL-CLIENT-ID':clientId } });
}
function authService(role:'user'|'member'|'admin', extra:Record<string,unknown>={}) {
  return { fetch: async () => Response.json({ ok:true, data:{ id:'usr_operator', display_name:'Operator', avatar_url:null, membership:{ role }, ...extra } }) };
}
function rejectedAuth(status=401) { return { fetch: async () => Response.json({ ok:false }, { status }) }; }
function envFor(DB:any, role:'user'|'member'|'admin'='admin', extra:Record<string,unknown>={}) {
  return { DB, AUTH_ORIGIN:'https://auth.example', AUTH_SERVICE:authService(role,extra) } as any;
}
async function call(request:Request, env:any) { return (app as any).fetch(request, env, ctx); }

function seedAccount(DB:any,id:string,userId:string,nickname:string,serverCode:string,isPrimary=0) {
  const now=Date.now();
  DB.raw.prepare('INSERT OR IGNORE INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run(userId,now,now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id,userId,nickname,serverCode,isPrimary,now,now);
}
function seedTargetData(DB:any) {
  const now=Date.now();
  seedAccount(DB,'gac_target','usr_target','고영 본계','5',1);
  seedAccount(DB,'gac_other','usr_other','다른 계정','12',0);
  DB.raw.prepare("INSERT INTO game_generals(id,name,enabled,metadata_json) VALUES ('g:1','장수A',1,'{}')").run();
  DB.raw.prepare("INSERT INTO game_tactics(id,name,enabled,metadata_json) VALUES ('t:1','전법A',1,'{}')").run();
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','무기A',1,'{}')").run();
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('m:1','mount','탈것A',1,'{}')").run();
  DB.raw.prepare("INSERT INTO user_generals(account_id,general_id,owned,breakthrough,promotion,favorite,note,updated_at) VALUES ('gac_target','g:1',1,2,3,1,'주력',?)").run(now);
  DB.raw.prepare("INSERT INTO user_tactics(account_id,tactic_id,owned,breakthrough,favorite,note,updated_at) VALUES ('gac_target','t:1',1,1,1,'핵심',?)").run(now);
  DB.raw.prepare("INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES ('eqp_w','gac_target','w:1','검',1,1,?,?)").run(now,now);
  DB.raw.prepare("INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES ('eqp_m','gac_target','m:1','말',0,1,?,?)").run(now,now);
  DB.raw.prepare("INSERT INTO decks(id,account_id,name,status,visibility,note,is_primary,created_at,updated_at) VALUES ('dek_target','gac_target','주력덱','active','private','ops test',1,?,?)").run(now,now);
  DB.raw.prepare("INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES ('dek_target',1,'g:1','eqp_w','eqp_m')").run();
  DB.raw.prepare("INSERT INTO deck_tactic_slots(deck_id,general_position,slot,tactic_id) VALUES ('dek_target',1,1,'t:1')").run();
  DB.raw.prepare("INSERT INTO deck_snapshots(id,source_deck_id,owner_user_id,visibility,snapshot_json,created_at) VALUES ('dks_target','dek_target','usr_target','alliance','{\"safe\":true}',?)").run(now);
}

test('DATA Ops authorization allows membership admin only', async () => {
  const DB=createSqliteD1(migration);
  let response=await call(opsReq('/internal/ops/accounts?q=gac'),envFor(DB,'admin'));
  assert.equal(response.status,200);

  response=await call(opsReq('/internal/ops/accounts?q=gac'),envFor(DB,'member'));
  assert.equal(response.status,403);
  assert.equal((await response.json() as any).error.code,'OPS_ADMIN_REQUIRED');

  response=await call(opsReq('/internal/ops/accounts?q=gac'),envFor(DB,'user'));
  assert.equal(response.status,403);
  assert.equal((await response.json() as any).error.code,'OPS_ADMIN_REQUIRED');

  response=await call(opsReq('/internal/ops/accounts?q=gac'),envFor(DB,'member',{ developer:{ active:true, role:'operator' } }));
  assert.equal(response.status,403,'active developer/operator without membership admin must remain denied');

  response=await call(opsReq('/internal/ops/accounts?q=gac','nakwol-data-lab'),envFor(DB,'admin'));
  assert.equal(response.status,403);
  assert.equal((await response.json() as any).error.code,'OPS_CLIENT_DENIED');

  const rejectedEnv={DB,AUTH_ORIGIN:'https://auth.example',AUTH_SERVICE:rejectedAuth(401)} as any;
  response=await call(opsReq('/internal/ops/accounts?q=gac'),rejectedEnv);
  assert.equal(response.status,401);
  assert.equal((await response.json() as any).error.code,'AUTH_REJECTED');
});

test('DATA Ops searches arbitrary game accounts by account id, user id, nickname and server code', async () => {
  const DB=createSqliteD1(migration);seedTargetData(DB);const env=envFor(DB,'admin');
  for (const query of ['gac_target','usr_target','고영','5']) {
    const response=await call(opsReq('/internal/ops/accounts?q='+encodeURIComponent(query)),env);
    assert.equal(response.status,200);
    const rows=(await response.json() as any).data;
    assert.ok(rows.some((row:any)=>row.id==='gac_target'),`target account missing for ${query}`);
  }
  const response=await call(opsReq('/internal/ops/accounts?q='+encodeURIComponent('없는닉네임')),env);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json() as any).data,[]);
});

test('DATA Ops account and deck detail expose arbitrary-user read state without secrets', async () => {
  const DB=createSqliteD1(migration);seedTargetData(DB);const env=envFor(DB,'admin');
  let response=await call(opsReq('/internal/ops/accounts/gac_target'),env);
  assert.equal(response.status,200);
  const detail=(await response.json() as any).data;
  assert.equal(detail.account.user_id,'usr_target');
  assert.equal(detail.generals[0].general_id,'g:1');
  assert.equal(detail.tactics[0].tactic_id,'t:1');
  assert.equal(detail.equipment.length,2);
  assert.equal(detail.decks[0].id,'dek_target');
  assert.equal(detail.snapshot_summary.count,1);
  assert.equal(detail.raw.account.id,'gac_target');
  assert.equal(detail.raw.snapshot_json,undefined);

  response=await call(opsReq('/internal/ops/accounts/gac_target/decks/dek_target'),env);
  assert.equal(response.status,200);
  const deck=(await response.json() as any).data;
  assert.equal(deck.deck.id,'dek_target');
  assert.equal(deck.deck.user_id,'usr_target');
  assert.equal(deck.generals[0].general_id,'g:1');
  assert.equal(deck.generals[0].tactics[0].tactic_id,'t:1');
  assert.equal(deck.generals[0].weapon.id,'eqp_w');
  assert.equal(deck.generals[0].mount.id,'eqp_m');
  assert.equal(deck.snapshot_summary.count,1);
});

test('DATA Ops surface and API are GET-only and excluded from normal OpenAPI', async () => {
  const ops=await source('ops.ts');
  const store=await source('ops-store.ts');
  const index=await source('index.ts');
  assert.match(index,/registerDataOpsRoutes\(app\)/);
  for (const route of [
    "app.get('/ops'",
    "app.get('/internal/ops/accounts'",
    "app.get('/internal/ops/accounts/:accountId'",
    "app.get('/internal/ops/accounts/:accountId/decks/:deckId'",
  ]) assert.ok(ops.includes(route),`missing read-only route ${route}`);
  assert.doesNotMatch(ops,/app\.(?:post|put|patch|delete)\('\/internal\/ops/);
  assert.doesNotMatch(ops,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(store,/\b(?:INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(ops,/Discord OAuth token|Cloudflare credential/i);
  const doc:any=buildDataOpenApi('https://data.example');
  assert.equal(Object.keys(doc.paths).some((path)=>path.startsWith('/internal/ops')),false);
});

test('DATA production workflow verifies the separate Ops page', async () => {
  const workflow=await readFile(new URL('../../../.github/workflows/deploy-data.yml',import.meta.url),'utf8');
  assert.match(workflow,/\/ops/);
  assert.match(workflow,/NAKWOL DATA OPS/);
  assert.match(workflow,/NAKWOL_DATA_OPS_DEPLOY_OK/);
});