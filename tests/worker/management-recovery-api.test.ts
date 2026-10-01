import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {authFixture} from '../helpers/auth-d1';
import {createSession} from '../../src/store';
import {sha256Base64Url} from '../../src/crypto';
import {registerServiceManagementRoutes} from '../../src/service-management-routes';
import {registerDeveloperSetupRoutes} from '../../src/developer-setup';
import {registerServerSessionRoutes} from '../../src/server-session-routes';
import type {Env} from '../../src/types';

test('policy receipt joins only the authorized app and policy operation, retaining unknown site profile',async t=>{
 const f=await authFixture();t.after(f.dispose);
 await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES('member','developer','active',0,0)").run();
 await f.env.DB.prepare("INSERT INTO application_owners VALUES('a','member','owner',0)").run();
 await f.env.DB.prepare("INSERT INTO access_tokens VALUES(?,'member','nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url('owner-token'),Date.now()+3600000,Date.now()).run();
 await f.env.DB.prepare("INSERT INTO auth_policy_operations VALUES('policy-a','app:a',7,'member','change policy','{}','{}',1000,'published')").run();
 await f.env.DB.prepare("INSERT INTO auth_policy_operations VALUES('policy-b','app:b',8,'member','other app','{}','{}',4000,'published')").run();
 for(const [id,client,operation,published,observed] of [['control-a','a','policy-a',2000,3000],['foreign-client','b','policy-a',5000,6000],['foreign-operation','a','policy-b',7000,8000]])
  await f.env.DB.prepare("INSERT INTO gate_control_outbox(operation_id,client_id,policy_operation_id,status,published_at,observed_at) VALUES(?,?,?,'published',?,?)").bind(id,client,operation,published,observed).run();
 const app=new Hono<{Bindings:Env}>();registerServiceManagementRoutes(app);
 const request=(client:string,operation:string)=>app.request('https://auth.test/developer/v1/apps/'+client+'/operations/'+operation,{headers:{Authorization:'Bearer owner-token'}},f.env);
 const response=await request('a','policy-a');assert.equal(response.status,200);
 const {data}=await response.json();assert.equal(data.createdAt,1000);assert.equal(data.siteProfile,'unconfirmed');assert.equal(data.allUsersObserved,false);
 assert.equal(data.control.receipts.length,1);assert.equal(data.control.receipts[0].operationId,'control-a');assert.equal(data.control.receipts[0].publishedAt,2000);assert.equal(data.control.receipts[0].observedAt,3000);
 assert.equal((await request('b','policy-b')).status,403);assert.equal((await request('a','policy-b')).status,404);
});

test('owned credential recovery requires recent auth, keeps old receipt private, and accepts a fresh setup at version zero',async t=>{
 const f=await authFixture();t.after(f.dispose);await createSession(f.env,'member');
 await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES('member','developer','active',0,0)").run();
 await f.env.DB.prepare("INSERT INTO application_owners VALUES('a','member','owner',0)").run();
 await f.env.DB.prepare("INSERT INTO access_tokens VALUES(?,'member','nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url('owner-token'),Date.now()+3600000,Date.now()).run();
 const app=new Hono<{Bindings:Env}>();registerDeveloperSetupRoutes(app);registerServerSessionRoutes(app);
 const request=(path:string,body:unknown)=>app.request('https://auth.test/developer/v1/apps/a/'+path,{method:'POST',headers:{Authorization:'Bearer owner-token',Origin:'https://auth.test','Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
 const document={schemaVersion:1,clientId:'a',siteOrigin:'https://old.test',provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:0,policyVersion:0,step:'install',idempotencyKey:crypto.randomUUID()};
 const saved=await request('setup',{setup:document,expectedVersion:0,reason:'initial old setup'});assert.equal(saved.status,200);
 const issue=await request('setup/'+document.idempotencyKey+'/credential',{expectedVersion:1,reason:'issue old credential'});assert.equal(issue.status,200);const old=(await issue.json()).data;assert.ok(old.secret);
 await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='member'").bind(Date.now()-1000000).run();
 assert.equal((await request('site-credentials/'+old.credentialId+'/revoke',{reason:'replace lost secret'})).status,403);
 const authenticatedAt=Date.now();await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='member'").bind(authenticatedAt).run();
 await f.env.DB.prepare("UPDATE access_tokens SET created_at=? WHERE user_id='member'").bind(authenticatedAt).run();
 assert.equal((await request('site-credentials/'+old.credentialId+'/revoke',{reason:'replace lost secret'})).status,200);
 const replay=await request('setup/'+document.idempotencyKey+'/credential',{expectedVersion:1,reason:'confirm old receipt'}),receipt=(await replay.json()).data;
 assert.equal(receipt.revoked,true);assert.equal(receipt.secret,undefined);assert.equal(receipt.credentialId,old.credentialId);
 const replacement={...document,idempotencyKey:crypto.randomUUID(),siteOrigin:'https://new.test'};
 assert.equal((await request('setup',{setup:replacement,expectedVersion:0,reason:'new site setup'})).status,200);
 const fresh=await request('setup/'+replacement.idempotencyKey+'/credential',{expectedVersion:1,reason:'issue replacement'});assert.equal(fresh.status,200);const next=(await fresh.json()).data;
 assert.notEqual(next.credentialId,old.credentialId);assert.ok(next.secret);assert.equal(next.siteOrigin,'https://new.test');
 const repeated=await request('setup/'+replacement.idempotencyKey+'/credential',{expectedVersion:1,reason:'replay replacement'});assert.equal(repeated.status,200);assert.equal((await repeated.json()).data.secret,undefined);
 const revoked=await f.env.DB.prepare('SELECT revoked_at FROM site_credentials WHERE id=?').bind(old.credentialId).first<{revoked_at:number|null}>();assert.ok(revoked?.revoked_at);
});
