import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { authFixture } from '../helpers/auth-d1';
import { sha256Base64Url } from '../../src/crypto';
import { registerServiceManagementRoutes } from '../../src/service-management-routes';
import { registerAuthPolicyAdminRoutes } from '../../src/auth-policy-admin';
import { requireAppTarget } from '../../src/service-management-auth';
import { getConnectPrincipal } from '../../src/connect-cli-store';
import type { Env } from '../../src/types';
import { createSession } from '../../src/store';

async function fixture() {
  const f = await authFixture();
  await f.env.DB.prepare("INSERT OR IGNORE INTO applications VALUES ('nakwol-connect-admin','Admin','[]','active',0,0)").run();
  for (const id of ['owner-a', 'owner-b', 'operator', 'ordinary']) {
    await f.env.DB.prepare("INSERT INTO users VALUES (?, ?, NULL, 'active', 0, 0)").bind(id, id).run();
    await createSession(f.env,id);
    await f.env.DB.prepare("INSERT INTO memberships(user_id,guild_id,is_guild_member,role,status,checked_at) VALUES (?, ?, 1, 'member', 'active', ?)").bind(id, f.env.NAKWOL_GUILD_ID, Date.now()).run();
    await f.env.DB.prepare('INSERT INTO access_tokens(token_hash,user_id,client_id,expires_at,created_at) VALUES (?,?,?,?,?)').bind(await sha256Base64Url(id), id, 'nakwol-connect-admin', Date.now()+3600000, Date.now()).run();
  }
  for (const [id, client] of [['owner-a','a'], ['owner-b','b']]) {
    await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES (?,'developer','active',0,0)").bind(id).run();
    await f.env.DB.prepare("INSERT INTO application_owners(client_id,user_id,role,created_at) VALUES (?,?,'owner',0)").bind(client,id).run();
  }
  await f.env.DB.prepare("INSERT INTO auth_operators(user_id,role,created_at) VALUES ('operator','operator',0)").run();
  const app = new Hono<{ Bindings: Env }>(); registerServiceManagementRoutes(app); registerAuthPolicyAdminRoutes(app);
  const req = (path: string, actor='owner-a', body?: unknown, origin='https://auth.test') => app.request('https://auth.test'+path, { method: body === undefined ? 'GET' : 'PUT', headers: { Authorization: 'Bearer '+actor, Origin: origin, 'Content-Type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  return { ...f, req };
}

test('management API enforces current ownership and operator authority without other-app data', async t => {
  const f=await fixture(); t.after(f.dispose);
  assert.equal((await f.req('/developer/v1/apps/a/policy')).status,200);
  assert.equal((await f.req('/developer/v1/apps/b/policy')).status,403);
  assert.equal((await f.req('/developer/v1/apps/a/policy','ordinary')).status,403);
  assert.equal((await f.req('/developer/v1/apps/a/policy','operator')).status,200);
  assert.equal((await f.req('/admin/api/auth-policy')).status,403);
  const list=await (await f.req('/developer/v1/apps')).json(); assert.deepEqual(list.data.apps,[{client_id:'a',name:'a'}]);
  await f.env.DB.prepare("UPDATE connect_developers SET role='operator' WHERE user_id='owner-a'").run();
  await f.env.DB.prepare("UPDATE memberships SET role='admin' WHERE user_id='owner-a'").run();
  assert.equal((await getConnectPrincipal(f.env,'owner-a'))?.isOperator,false);
  assert.equal((await f.req('/admin/api/auth-policy')).status,403);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();
  assert.equal((await f.req('/developer/v1/apps/a/policy')).status,403);
});

test('management mutation rejects CSRF, stale OAuth, overflow and foreign target injection', async t => {
  const f=await fixture(); t.after(f.dispose);
  const body={expectedVersion:0,patch:{leaseSeconds:120},reason:'test policy'};
  assert.equal((await f.req('/developer/v1/apps/a/policy','owner-a',body,'https://evil.test')).status,403);
  assert.equal((await f.req('/developer/v1/apps/a/policy','owner-a',{...body,reason:'x'.repeat(9000)})).status,413);
  for (const key of ['clientId','subject','sessionId','operationId','cursor','supportCode']) {
    assert.equal((await f.req('/developer/v1/apps/a/policy','owner-a',{...body,[key]:'b'})).status,400);
  }
  await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='owner-a'").bind(Date.now()-900001).run();
  await f.env.DB.prepare("UPDATE memberships SET checked_at=? WHERE user_id='owner-a'").bind(Date.now()).run();
  assert.equal((await f.req('/developer/v1/apps/a/policy','owner-a',body)).status,403);
  await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='owner-a'").bind(Date.now()+900000).run();
  assert.equal((await f.req('/developer/v1/apps/a/policy','owner-a',body)).status,403);
  await assert.rejects(requireAppTarget(f.env,'a',{operationId:'foreign'}), /NOT_FOUND/);
});

test('policy mutation rejects stale bearer even after a new real OAuth family exists',async t=>{
  const f=await fixture();t.after(f.dispose);
  await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='operator'").bind(Date.now()-900001).run();
  const body={expectedVersion:0,patch:{leaseSeconds:60},reason:'real OAuth boundary'};
  assert.equal((await f.req('/admin/api/auth-policy/a','operator',body)).status,403);
  await createSession(f.env,'operator');
  assert.equal((await f.req('/admin/api/auth-policy/a','operator',body)).status,403);
  await f.env.DB.prepare("UPDATE access_tokens SET created_at=? WHERE user_id='operator'").bind(Date.now()).run();
  assert.equal((await f.req('/admin/api/auth-policy/a','operator',body)).status,200);
});

test('atomic management rate limiter bounds concurrent mutation requests', async t => {
  const f=await fixture(); t.after(f.dispose);
  const body={expectedVersion:0,patch:{leaseSeconds:0},reason:'invalid policy'};
  const responses=await Promise.all(Array.from({length:25},()=>f.req('/developer/v1/apps/a/policy','owner-a',body)));
  assert.equal(responses.filter(r=>r.status===429).length,5);
  assert.equal(responses.filter(r=>r.status===400).length,20);
});

test('owner policy save emits only scoped operation metadata; app credentials are rejected', async t => {
  const f=await fixture(); t.after(f.dispose);
  const before=await (await f.req('/developer/v1/apps/a/policy')).json();
  const save=await f.req('/developer/v1/apps/a/policy','owner-a',{expectedVersion:before.data.policyVersion,patch:{leaseSeconds:120},reason:'owner policy update'});
  assert.equal(save.status,200);
  const result=await save.json(); assert.ok(result.data.operationId);
  const operation=await f.req('/developer/v1/apps/a/operations/'+result.data.operationId);
  assert.equal(operation.status,200);
  assert.deepEqual(Object.keys((await operation.json()).data).sort(),['createdAt','deliveryStatus','operationId','policyVersion']);
  assert.equal((await f.req('/developer/v1/apps/b/operations/'+result.data.operationId,'owner-b')).status,404);
  await f.env.DB.prepare("UPDATE access_tokens SET client_id='a' WHERE user_id='owner-a'").run();
  assert.equal((await f.req('/developer/v1/apps/a/policy')).status,401);
});

test('legacy app metadata edits preserve a policy changed after the precheck', async t => {
  const f=await fixture(); t.after(f.dispose);
  const { registerConnectCliAppRoutes }=await import('../../src/connect-cli-apps');
  const { registerHooks } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const hooks = registerHooks({ load(url, context, nextLoad) {
    if (url.endsWith('.txt')) return { format: 'module', source: 'export default '+JSON.stringify(readFileSync(new URL(url), 'utf8')), shortCircuit: true };
    return nextLoad(url, context);
  } });
  const { registerConnectRoutes }=await import('../../src/connect');
  hooks.deregister();
  const app=new Hono<{Bindings:Env}>(); registerConnectCliAppRoutes(app); registerConnectRoutes(app);
  await f.env.DB.prepare("INSERT INTO applications VALUES ('race-app','Race','[\"https://a.test/callback\"]','active',0,0)").run();
  await f.env.DB.prepare("INSERT INTO application_owners VALUES ('race-app','owner-a','owner',0)").run();
  await f.env.DB.prepare("INSERT INTO application_settings(client_id,homepage_url,framework,access_policy,owner_user_id,created_at,updated_at) VALUES ('race-app','https://a.test','html','member','owner-a',0,0)").run();
  await f.env.DB.prepare("INSERT INTO connect_cli_tokens(token_hash,user_id,scopes,expires_at,created_at,last_used_at) VALUES (?,'owner-a','[\"connect:apps\"]',?,0,0)").bind(await sha256Base64Url('cli-a'),Date.now()+3600000).run();
  const realDB=f.env.DB;
  // Inject the audited policy writer between the route's SELECT/precheck and batch.
  const raceDB=new Proxy(realDB,{get(target,property){
    if(property==='batch')return async (statements:D1PreparedStatement[])=>{
      await realDB.prepare("UPDATE application_settings SET access_policy='admin' WHERE client_id='race-app'").run();
      return realDB.batch(statements);
    };
    const value=Reflect.get(target,property); return typeof value==='function'?value.bind(target):value;
  }});
  const env={...f.env,DB:raceDB};
  for(const [path,method,token] of [['/connect/cli/apps/race-app','PATCH','cli-a'],['/admin/api/apps/race-app','PUT','operator']]){
    await realDB.prepare("UPDATE application_settings SET access_policy='member' WHERE client_id='race-app'").run();
    const res=await app.request('https://auth.test'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'Metadata edit',homepage_url:'https://a.test',redirect_uris:['https://a.test/callback'],framework:'html',access_policy:'member',status:'active'})},env);
    assert.equal(res.status,200,await res.text());
    assert.equal((await realDB.prepare("SELECT access_policy FROM application_settings WHERE client_id='race-app'").first<{access_policy:string}>())?.access_policy,'admin');
  }
});
