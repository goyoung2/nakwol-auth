import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Hono } from 'hono';
import { authFixture } from '../helpers/auth-d1';
import { sha256Base64Url } from '../../src/crypto';
import { createSession, upsertMembership } from '../../src/store';
import { evaluateAccess } from '../../src/policy';
import { registerConnectCliAppRoutes } from '../../src/connect-cli-apps';
import { previewAdminAction, commitAdminAction, type AdminAction } from '../../src/admin-operations';
import type { Env } from '../../src/types';

test('legacy metadata routes cannot undo audited operator app locks', async t => {
  const bundle=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});
  const f=await authFixture(bundle.outputFiles[0].text);t.after(f.dispose);
  const db=f.env.DB;
  await db.prepare("INSERT INTO applications VALUES('locked-app','fixture','[\"https://a.test/callback\"]','active',0,0)").run();
  for(const id of ['owner','operator']) {
    await db.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();
    await createSession(f.env,id);
    await db.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES(?,'developer','active',0,0)").bind(id).run();
    await db.prepare("INSERT INTO connect_cli_tokens(token_hash,user_id,scopes,expires_at,created_at,last_used_at) VALUES(?,?,'[\"connect:apps\"]',?,0,0)").bind(await sha256Base64Url(id+'-cli'),id,Date.now()+3600000).run();
  }
  await db.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('operator',0)").run();
  await db.prepare("INSERT INTO application_owners(client_id,user_id,created_at) VALUES('locked-app','owner',0)").run();
  await db.prepare("INSERT INTO application_settings(client_id,framework,access_policy,created_at,updated_at) VALUES('locked-app','html','member',0,0)").run();
  await db.prepare("INSERT INTO access_tokens VALUES(?,'operator','nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url('operator-web'),Date.now()+3600000,Date.now()).run();
  await upsertMembership(f.env,'member',true,'member',['season3']);
  await createSession(f.env,'member');
  const authenticatedAt=(await db.prepare("SELECT created_at FROM auth_sessions WHERE user_id='operator'").first<{created_at:number}>())?.created_at;
  assert.ok(authenticatedAt);
  const actor={userId:'operator',authenticatedAt};
  const apply=async(action:'lock-app'|'unlock-app')=>{
    const input:AdminAction={action,scope:'app',reason:'fixture audited status change'};
    const p=await previewAdminAction(f.env,actor,'locked-app',input);
    return commitAdminAction(f.env,actor,'locked-app',input,{previewToken:p.previewToken,expectedVersion:p.version,idempotencyKey:crypto.randomUUID()});
  };
  const cli=(body:unknown,actor='owner')=>f.dispatchFetch('https://auth.test/connect/cli/apps/locked-app',{method:'PATCH',headers:{Authorization:'Bearer '+actor+'-cli','Content-Type':'application/json'},body:JSON.stringify(body)});
  const admin=(status?:string,name='metadata update')=>f.dispatchFetch('https://auth.test/admin/api/apps/locked-app',{method:'PUT',headers:{Authorization:'Bearer operator-web','Content-Type':'application/json'},body:JSON.stringify({name,homepage_url:'https://a.test/',redirect_uris:['https://a.test/callback'],framework:'html',access_policy:'member',status})});

  await apply('lock-app');
  await t.test('owner and operator CLI status changes require the audited workflow',async()=>{
    assert.equal((await evaluateAccess(f.env,'member','locked-app')).reason,'APP_DISABLED');
    for(const actor of ['owner','operator']) {
      const r=await cli({status:'active'},actor);
      assert.equal(r.status,409);
      assert.equal((await r.json()).error.code,'APP_STATUS_WORKFLOW_REQUIRED');
    }
    assert.equal((await db.prepare("SELECT status FROM applications WHERE client_id='locked-app'").first())?.status,'disabled');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admin_operations WHERE action='unlock-app'").first())?.n,0);
  });
  await t.test('legacy admin app editor also preserves the lock',async()=>{
    await apply('lock-app');
    const r=await admin('active');assert.equal(r.status,409);
    assert.equal((await r.json()).error.code,'APP_STATUS_WORKFLOW_REQUIRED');
    assert.equal((await evaluateAccess(f.env,'member','locked-app')).reason,'APP_DISABLED');
  });
  await t.test('locked app metadata remains editable without changing status',async()=>{
    assert.equal((await cli({name:'owner metadata'})).status,200);
    assert.equal((await admin('disabled','operator metadata')).status,200);
    assert.equal((await admin(undefined,'omitted status metadata')).status,200);
    assert.equal((await cli({status:'invalid'})).status,400);
    assert.equal((await db.prepare("SELECT status FROM applications WHERE client_id='locked-app'").first())?.status,'disabled');
    assert.equal((await db.prepare("SELECT status FROM applications WHERE client_id='b'").first())?.status,'active');
  });
  await t.test('audited unlock restores member access and retains its operation receipt',async()=>{
    const result=await apply('unlock-app');assert.ok(result.id);
    assert.equal((await evaluateAccess(f.env,'member','locked-app')).allowed,true);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admin_operations WHERE action='unlock-app'").first())?.n,1);
  });
  await t.test('a metadata write never restores a stale active status after a concurrent lock',async()=>{
    const app=new Hono<{Bindings:Env}>();registerConnectCliAppRoutes(app);
    const raceDb=new Proxy(db,{get(target,property){
      if(property==='batch')return async(statements:D1PreparedStatement[])=>{
        await target.prepare("UPDATE applications SET status='disabled' WHERE client_id='locked-app'").run();
        return target.batch(statements);
      };
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }});
    const r=await app.request('https://auth.test/connect/cli/apps/locked-app',{method:'PATCH',headers:{Authorization:'Bearer owner-cli','Content-Type':'application/json'},body:JSON.stringify({name:'concurrent metadata'})},{...f.env,DB:raceDb});
    assert.equal(r.status,200);
    assert.equal((await db.prepare("SELECT status FROM applications WHERE client_id='locked-app'").first())?.status,'disabled');
  });
});

test('admin impact preview counts the selected session or known user, not every app session',async t=>{
  const f=await authFixture();t.after(f.dispose);const db=f.env.DB,now=Date.now();
  await db.prepare("INSERT INTO users VALUES('operator','Operator',NULL,'active',0,0)").run();
  await db.prepare("INSERT INTO auth_identities VALUES('identity','member','discord','1553600098661957644',0,0)").run();
  await db.prepare("INSERT INTO site_credentials VALUES('credential','hash','a','https://a.test',0,NULL)").run();
  for(const [id,userId,clientId] of [['session-a1','member','a'],['session-a2','member','a'],['session-b','member','b'],['session-other','operator','a']]) {
    await db.prepare(`INSERT INTO server_sessions(id,handle_hash,user_id,client_id,site_origin,credential_id,auth_session_hash,created_at,last_used_at,idle_expires_at,absolute_expires_at,idle_seconds,absolute_seconds,source,verified_at,lease_until,evidence_until,policy_version) VALUES(?,?,?,?,?,'credential','family',?,?,?,?,7200,86400,'member',?,?,?,0)`).bind(id,id,userId,clientId,'https://'+clientId+'.test',now,now,now+86400000,now+86400000,now,now+300000,now+900000).run();
  }
  const actor={userId:'operator',authenticatedAt:now};
  const preview=(input:AdminAction)=>previewAdminAction(f.env,actor,'a',input);
  assert.equal((await preview({action:'revoke-session',scope:'app',discordId:'1553600098661957644',sessionId:'session-a1',reason:'fixture selected session'})).affectedSessions,1);
  assert.equal((await preview({action:'deny',scope:'app',discordId:'1553600098661957699',reason:'fixture preregister deny'})).affectedSessions,0);
  assert.equal((await preview({action:'deny',scope:'app',discordId:'1553600098661957644',reason:'fixture app user deny'})).affectedSessions,2);
  assert.equal((await preview({action:'deny',scope:'global',discordId:'1553600098661957644',reason:'fixture global user deny'})).affectedSessions,3);
  assert.equal((await preview({action:'lock-app',scope:'app',reason:'fixture app impact'})).affectedSessions,3);
});
