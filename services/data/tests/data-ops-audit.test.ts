import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const initial = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const audit = await readFile(new URL('../migrations/0007_data_ops_audit.sql', import.meta.url), 'utf8');
const schema = `${initial}\n${audit}`;
const ctx = { waitUntil() {}, passThroughOnException() {} };

function authService(role:'user'|'member'|'admin') {
  return { fetch: async () => Response.json({ ok:true, data:{ id:'usr_operator', display_name:'Operator', avatar_url:null, membership:{ role } } }) };
}
function envFor(DB:any, role:'user'|'member'|'admin'='admin') {
  return { DB, AUTH_ORIGIN:'https://auth.example', AUTH_SERVICE:authService(role) } as any;
}
function opsReq(path:string, clientId='nakwol-data-ops') {
  return new Request(`https://data.example${path}`, { headers:{ Authorization:'Bearer test-token', 'X-NAKWOL-CLIENT-ID':clientId } });
}
async function call(request:Request, env:any) { return (app as any).fetch(request, env, ctx); }
function seedTarget(DB:any) {
  const now=Date.now();
  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_target',now,now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,1,?,?)').run('gac_target','usr_target','audit-target','7',now,now);
  DB.raw.prepare("INSERT INTO decks(id,account_id,name,status,visibility,is_primary,created_at,updated_at) VALUES ('dek_target','gac_target','audit deck','active','private',1,?,?)").run(now,now);
}
function auditRows(DB:any) {
  return DB.raw.prepare('SELECT id,operator_user_id,target_user_id,target_account_id,action,request_id,created_at FROM data_ops_audit_log ORDER BY rowid').all() as any[];
}

test('DATA Ops audit migration has only the SSOT fields and constrained actions', () => {
  const DB=createSqliteD1(schema);
  const columns=(DB.raw.prepare('PRAGMA table_info(data_ops_audit_log)').all() as any[]).map((row)=>row.name);
  assert.deepEqual(columns,['id','operator_user_id','target_user_id','target_account_id','action','request_id','created_at']);
  assert.throws(()=>DB.raw.prepare("INSERT INTO data_ops_audit_log(id,operator_user_id,action,request_id,created_at) VALUES ('x','u','NOT_ALLOWED','r',1)").run());
  DB.raw.exec(audit);
  assert.deepEqual((DB.raw.prepare('PRAGMA table_info(data_ops_audit_log)').all() as any[]).map((row)=>row.name),columns);
});

test('successful admin search, account view and deck view are audited with no raw search text', async () => {
  const DB=createSqliteD1(schema);seedTarget(DB);const env=envFor(DB,'admin');
  const rawSearch='audit-target';

  let response=await call(opsReq('/internal/ops/accounts?q='+encodeURIComponent(rawSearch)),env);
  assert.equal(response.status,200);
  response=await call(opsReq('/internal/ops/accounts/gac_target'),env);
  assert.equal(response.status,200);
  response=await call(opsReq('/internal/ops/accounts/gac_target/decks/dek_target'),env);
  assert.equal(response.status,200);

  const rows=auditRows(DB);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map((row)=>row.action),['SEARCH_ACCOUNT','VIEW_ACCOUNT','VIEW_DECK']);
  assert.ok(rows.every((row)=>row.operator_user_id==='usr_operator'));
  assert.equal(rows[0].target_user_id,null);
  assert.equal(rows[0].target_account_id,null);
  assert.equal(rows[1].target_user_id,'usr_target');
  assert.equal(rows[1].target_account_id,'gac_target');
  assert.equal(rows[2].target_user_id,'usr_target');
  assert.equal(rows[2].target_account_id,'gac_target');
  assert.ok(rows.every((row)=>String(row.id).startsWith('opa_')));
  assert.ok(rows.every((row)=>String(row.request_id).startsWith('ops_')));
  assert.equal(JSON.stringify(rows).includes(rawSearch),false,'raw search text must not be persisted in audit rows');
});

test('denied and unsuccessful Ops requests do not create successful-view audit rows', async () => {
  const DB=createSqliteD1(schema);seedTarget(DB);

  let response=await call(opsReq('/internal/ops/accounts/gac_target'),envFor(DB,'member'));
  assert.equal(response.status,403);
  assert.equal(auditRows(DB).length,0);

  response=await call(opsReq('/internal/ops/accounts/gac_target','nakwol-data-lab'),envFor(DB,'admin'));
  assert.equal(response.status,403);
  assert.equal(auditRows(DB).length,0);

  response=await call(opsReq('/internal/ops/accounts/gac_missing'),envFor(DB,'admin'));
  assert.equal(response.status,404);
  assert.equal(auditRows(DB).length,0);
});

test('successful Ops read fails closed when the audit table is unavailable', async () => {
  const DB=createSqliteD1(initial);seedTarget(DB);
  const response=await call(opsReq('/internal/ops/accounts?q=audit-target'),envFor(DB,'admin'));
  assert.equal(response.status,500,'an unaudited arbitrary-user read must not be returned as success');
  assert.equal((await response.json() as any).error.code,'INTERNAL_ERROR');
});

test('Ops auditing mutates only the audit table, not target user DATA', async () => {
  const DB=createSqliteD1(schema);seedTarget(DB);const env=envFor(DB,'admin');
  const beforeAccount=DB.raw.prepare('SELECT * FROM game_accounts WHERE id=?').get('gac_target');
  const beforeDeck=DB.raw.prepare('SELECT * FROM decks WHERE id=?').get('dek_target');
  const beforeUsers=DB.raw.prepare('SELECT COUNT(*) AS n FROM data_users').get() as any;

  assert.equal((await call(opsReq('/internal/ops/accounts?q=audit-target'),env)).status,200);
  assert.equal((await call(opsReq('/internal/ops/accounts/gac_target'),env)).status,200);
  assert.equal((await call(opsReq('/internal/ops/accounts/gac_target/decks/dek_target'),env)).status,200);

  assert.deepEqual(DB.raw.prepare('SELECT * FROM game_accounts WHERE id=?').get('gac_target'),beforeAccount);
  assert.deepEqual(DB.raw.prepare('SELECT * FROM decks WHERE id=?').get('dek_target'),beforeDeck);
  assert.equal((DB.raw.prepare('SELECT COUNT(*) AS n FROM data_users').get() as any).n,beforeUsers.n);
  assert.equal(auditRows(DB).length,3);
});

test('normal consumer routes cannot write DATA Ops audit rows', async () => {
  const opsAudit=await readFile(new URL('../src/ops-audit.ts',import.meta.url),'utf8');
  const ops=await readFile(new URL('../src/ops.ts',import.meta.url),'utf8');
  const index=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const store=await readFile(new URL('../src/store.ts',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../../../.github/workflows/deploy-data.yml',import.meta.url),'utf8');

  assert.match(opsAudit,/INSERT INTO data_ops_audit_log/);
  assert.doesNotMatch(ops,/['"]\/internal\/ops\/audit/);
  assert.doesNotMatch(index,/data_ops_audit_log/);
  assert.doesNotMatch(store,/data_ops_audit_log/);
  assert.doesNotMatch(opsAudit,/Authorization|access.?token|discord|secret/i);
  assert.match(workflow,/NAKWOL_DATA_OPS_AUDIT_SCHEMA_OK/);
  assert.match(workflow,/data_ops_audit_log/);
});