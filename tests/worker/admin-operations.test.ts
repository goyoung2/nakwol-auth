import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { authFixture } from '../helpers/auth-d1';
import { createSession, upsertMembership } from '../../src/store';
import { previewAdminAction, commitAdminAction, type AdminAction } from '../../src/admin-operations';
import { sha256Base64Url } from '../../src/crypto';
import { saveAuthPolicy, resolveAuthPolicy } from '../../src/auth-policy-settings';
import { exchangeServerCode, refreshServerSession } from '../../src/server-sessions';
import { issueSiteCredential } from '../../src/site-credentials';
import { createAuthorizationCode } from '../../src/store';
import { Script } from 'node:vm';

test('operator actions preview, CAS, retry and recover without making protected content public', async t => {
  const bundle = await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});
  const f = await authFixture(bundle.outputFiles[0].text); t.after(f.dispose);
  const db=f.env.DB, discord='1553600098661957644';
  for(const id of ['operator','owner-a','owner-b','ordinary']) {
    await db.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();
    await createSession(f.env,id);
    await db.prepare("INSERT INTO access_tokens VALUES(?,?,'nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url(id),id,Date.now()+3600000,Date.now()).run();
  }
  await db.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('operator',0)").run();
  await db.prepare("INSERT INTO auth_identities VALUES('identity','member','discord',?,0,0)").bind(discord).run();
  await db.prepare("INSERT INTO auth_identities VALUES('op-identity','operator','discord','1553600098661957645',0,0)").run();
  for(const [id,app] of [['owner-a','a'],['owner-b','b']]) {
    await db.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES(?,'developer','active',0,0)").bind(id).run();
    await db.prepare("INSERT INTO application_owners(client_id,user_id,created_at) VALUES(?,?,0)").bind(app,id).run();
  }
  await upsertMembership(f.env,'member',true,'member',['season3']);
  await upsertMembership(f.env,'operator',true,'member',['season3']);
  await db.prepare("INSERT INTO access_tokens VALUES(?,'member','a',?,NULL,?)").bind(await sha256Base64Url('member-token'),Date.now()+3600000,Date.now()).run();
  const req=(path:string,body?:unknown,actor='operator',origin='https://auth.test')=>f.dispatchFetch('https://auth.test'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+actor,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const change=(action:string,extra:Record<string,unknown>={})=>({action,discordId:discord,reason:'fixture support action',...extra});
  const apply=async(body:Record<string,unknown>,key=crypto.randomUUID())=> {
    const preview=await req('/admin/api/operations/a/preview',body);assert.equal(preview.status,200,await preview.clone().text());
    const p=await preview.json<{previewToken:string;version:number}>();
    return req('/admin/api/operations/a',{...body,previewToken:p.previewToken,expectedVersion:p.version,idempotencyKey:key});
  };
  const me=()=>req('/me?client_id=a',undefined,'member-token','https://a.test');
  await t.test('recovery page sends executable browser code',async()=>{
    const html=await (await req('/admin/recovery')).text();
    const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);
    assert.doesNotThrow(()=>new Script(scripts[0][1]));
  });
  await t.test('current owner and ordinary principals receive no central diagnostics or mutations',async()=>{
    for(const actor of ['owner-a','owner-b','ordinary']) {
      assert.equal((await req('/admin/api/operations/a/diagnosis?discord_id='+discord,undefined,actor)).status,403);
      assert.equal((await req('/admin/api/operations/a/preview',change('deny'),actor)).status,403);
    }
    assert.equal((await req('/admin/api/operations/a/preview',change('deny'),'operator','https://evil.test')).status,403);
  });
  await t.test('deny is independent of grant and clear-deny restores normal member access',async()=>{
    assert.equal((await me()).status,200);
    const response=await apply(change('deny'));assert.equal(response.status,200,await response.clone().text());
    const op=await response.json<{id:string;delivery:{status:string;fastRevocationSupported:boolean}}>();
    assert.ok(op.id);assert.equal(op.delivery.status,'pending');assert.equal(op.delivery.fastRevocationSupported,false);
    const blocked=await me();assert.equal(blocked.status,403);const error=await blocked.json();assert.ok(error.error.trace_id);assert.equal(JSON.stringify(error).includes('role_ids'),false);
    await db.prepare("INSERT INTO applications VALUES('nakwol-account-center','account','[\"https://auth.test/account\"]','active',0,0)").run();
    await db.prepare("INSERT INTO access_tokens VALUES(?,'member','nakwol-account-center',?,NULL,?)").bind(await sha256Base64Url('account-member'),Date.now()+3600000,Date.now()).run();
    const recovery=await req('/account/api/recovery?client_id=a',undefined,'account-member');assert.equal(recovery.status,200);
    const ownSupport=await recovery.json();assert.ok(ownSupport.data.traceId);assert.equal(JSON.stringify(ownSupport).includes('role_ids'),false);
    assert.equal((await req('/admin/api/operations/a/diagnosis?trace_id='+ownSupport.data.traceId)).status,200);
    const accountHtml=await(await req('/account')).text();assert.ok(accountHtml.includes('recovery-trace'));
    assert.equal((await apply(change('grant',{expiresAt:Date.now()+600000}))).status,200);
    assert.equal((await me()).status,403);
    assert.equal((await apply(change('clear-deny'))).status,200);assert.equal((await me()).status,200);
    const diagnosis=await req('/admin/api/operations/a/diagnosis?trace_id='+error.error.trace_id);assert.equal(diagnosis.status,200);
    assert.equal((await diagnosis.json()).user.id,'member');
  });
  await t.test('one action retry returns one operation and conflicts on changed payload or stale version',async()=>{
    const body=change('deny'),p=await req('/admin/api/operations/a/preview',body),preview=await p.json<{previewToken:string;version:number}>();
    const commit={...body,previewToken:preview.previewToken,expectedVersion:preview.version,idempotencyKey:'same-request'};
    const [a,b]=await Promise.all([req('/admin/api/operations/a',commit),req('/admin/api/operations/a',commit)]);
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal((await a.json()).id,(await b.json()).id);
    assert.equal((await req('/admin/api/operations/a',{...commit,reason:'different reason'})).status,409);
    const stale=await req('/admin/api/operations/a/preview',change('clear-deny')),old=await stale.json<{previewToken:string;version:number}>();
    await db.prepare("UPDATE applications SET status='disabled' WHERE client_id='b'").run();
    assert.equal((await req('/admin/api/operations/a',{...change('clear-deny'),previewToken:old.previewToken,expectedVersion:old.version,idempotencyKey:'stale'})).status,409);
    assert.equal((await apply(change('clear-deny'))).status,200);
  });
  await t.test('last operator global deny and control app lockout are rejected',async()=>{
    assert.equal((await req('/admin/api/operations/a/preview',change('deny',{scope:'global',discordId:'1553600098661957645'}))).status,409);
    assert.equal((await req('/admin/api/operations/nakwol-connect-admin/preview',{action:'lock-app',reason:'fixture control lockout'})).status,409);
    assert.equal((await req('/admin/api/operations/nakwol-account-center/preview',{action:'lock-app',reason:'fixture recovery lockout'})).status,409);
  });
  await t.test('fresh OAuth is required even when roles were recently refreshed',async()=>{
    await db.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='operator'").bind(Date.now()-901000).run();
    assert.equal((await req('/admin/api/operations/a/preview',change('deny'))).status,403);
    await createSession(f.env,'operator');
    await db.prepare('UPDATE access_tokens SET created_at=? WHERE token_hash=?').bind(Date.now(),await sha256Base64Url('operator')).run();
    await db.prepare('DELETE FROM service_management_rate_limits').run();
  });
  await t.test('temporary grant expiry and app lock/unlock never lower role requirements',async()=>{
    assert.equal((await apply(change('revoke'))).status,200);
    const lock=await apply({action:'lock-app',reason:'fixture maintenance'});assert.equal(lock.status,200);
    assert.equal((await me()).status,401);
    const unlock=await apply({action:'unlock-app',reason:'fixture restore application'});assert.equal(unlock.status,200);assert.equal((await me()).status,200);
    await db.prepare("UPDATE memberships SET role_ids='[]',role='user' WHERE user_id='member'").run();
    await db.prepare("UPDATE application_access_grants SET status='active',expires_at=? WHERE client_id='a'").bind(Date.now()-1).run();
    assert.equal((await me()).status,403);
    assert.equal((await apply(change('refresh-membership'))).status,200);
  });
  await t.test('one-use recovery restores only the selected setting and never grants data access',async()=>{
    await db.prepare('DELETE FROM service_management_rate_limits').run();
    const issued=await req('/admin/api/recovery/issue',{reason:'fixture offline recovery backup',clientId:'a'});assert.equal(issued.status,200,await issued.clone().text());
    const code=await issued.json<{code:string}>();
    await apply({action:'lock-app',reason:'fixture locked service'});
    const consume=(value:string)=>f.dispatchFetch('https://auth.test/admin/api/recovery/consume',{method:'POST',headers:{Origin:'https://auth.test','Content-Type':'application/json'},body:JSON.stringify({code:value,reason:'fixture recovery restore',action:'unlock-app'})});
    assert.equal((await consume(code.code)).status,200);
    assert.equal((await consume(code.code)).status,403);
    assert.equal((await me()).status,403,'no member role: recovery must not allow content');
    const stored=await db.prepare('SELECT * FROM admin_recovery_codes').all();assert.equal(JSON.stringify(stored).includes(code.code),false);
  });
  await t.test('a scoped session revoke preserves other app and central SSO families',async()=>{
    await db.prepare('DELETE FROM service_management_rate_limits').run();
    await upsertMembership(f.env,'member',true,'member',['season3']);
    await db.prepare("UPDATE applications SET status='active' WHERE client_id='b'").run();
    const family=await createSession(f.env,'member'),verifier='v'.repeat(43);
    const issued=[];
    for(const clientId of ['a','b']) {
      const origin=`https://${clientId}.test`,redirect=origin+'/__nakwol/callback';
      await db.prepare('UPDATE applications SET redirect_uris=? WHERE client_id=?').bind(JSON.stringify([redirect]),clientId).run();
      const credential=await issueSiteCredential(f.env,'operator',clientId,origin,'fixture session test');
      const code=await createAuthorizationCode(f.env,'member',clientId,redirect,await sha256Base64Url(verifier),family.token);
      const binding={clientId,siteOrigin:origin,credential:credential.secret};
      const session=await exchangeServerCode(f.env,{...binding,code,redirectUri:redirect,codeVerifier:verifier});
      issued.push({...binding,...session});
    }
    assert.equal((await req('/admin/api/operations/a/preview',change('revoke-session',{sessionId:issued[1].session.sessionId}))).status,404,'app B session cannot be revoked under A');
    assert.equal((await apply(change('revoke-session',{sessionId:issued[0].session.sessionId}))).status,200);
    await assert.rejects(refreshServerSession(f.env,{...issued[0],sessionId:issued[0].session.sessionId,expectedGeneration:0}),/SESSION_EXPIRED/);
    assert.ok((await refreshServerSession(f.env,{...issued[1],sessionId:issued[1].session.sessionId,expectedGeneration:0})).session);
    assert.ok(await db.prepare('SELECT 1 FROM auth_sessions WHERE token_hash=?').bind(await sha256Base64Url(family.token)).first());
  });
  await t.test('policy restore creates a new version and persists shortened session boundaries',async()=>{
    const first=await saveAuthPolicy(f.env,{actor:'operator',clientId:'a',expectedVersion:0,patch:{sessionIdleSeconds:3600,sessionAbsoluteSeconds:3600},reason:'fixture short sessions'});
    const second=await saveAuthPolicy(f.env,{actor:'operator',clientId:'a',expectedVersion:first.policyVersion,patch:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:7200},reason:'fixture lengthen sessions'});
    assert.ok('operationId' in second);
    await db.prepare("UPDATE server_sessions SET absolute_seconds=7200,idle_seconds=7200,absolute_expires_at=created_at+7200000,idle_expires_at=last_used_at+7200000 WHERE client_id='a'").run();
    const before=await db.prepare('SELECT absolute_expires_at FROM server_sessions WHERE client_id=\'a\' LIMIT 1').first<{absolute_expires_at:number}>();assert.ok(before);
    const restored=await apply({action:'restore-policy',policyOperationId:second.operationId,reason:'fixture restore previous session policy'});assert.equal(restored.status,200,await restored.clone().text());
    const policy=await resolveAuthPolicy(f.env,'a');assert.equal(policy.effective.sessionAbsoluteSeconds,3600);assert.ok(policy.policyVersion>second.policyVersion);
    const after=await db.prepare('SELECT absolute_expires_at FROM server_sessions WHERE client_id=\'a\' LIMIT 1').first<{absolute_expires_at:number}>();assert.ok(after);assert.ok(after.absolute_expires_at<before.absolute_expires_at);
    const invalid=await req('/admin/api/operations/b/preview',{action:'restore-policy',policyOperationId:second.operationId,reason:'fixture cross-app restore'});assert.equal(invalid.status,404);
  });
});

test('policy recovery cannot downgrade admin or lab to member',async t=>{
  const f=await authFixture();t.after(f.dispose);
  await f.env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('member',0)").run();
  const actor={userId:'member',authenticatedAt:Date.now()};
  await f.env.DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('a','member',0,0)").run();
  for(const accessPolicy of ['admin','lab']){
    await f.env.DB.prepare("UPDATE application_settings SET access_policy='member' WHERE client_id='a'").run();
    const previous=await resolveAuthPolicy(f.env,'a');
    const input={actor:'member',clientId:'a',expectedVersion:previous.policyVersion,reason:'restrict service',patch:{accessPolicy}};
    const preview=await saveAuthPolicy(f.env,{...input,preview:true});
    const saved=await saveAuthPolicy(f.env,{...input,previewToken:preview.previewToken});
    await assert.rejects(previewAdminAction(f.env,actor,'a',{action:'restore-policy',scope:'app',reason:'recover restrictive policy',policyOperationId:saved.operationId}),/POLICY_RESTORE_WOULD_RELAX_ACCESS/);
    assert.equal((await resolveAuthPolicy(f.env,'a')).accessPolicy,accessPolicy);
  }
});

async function refreshOperationFixture() {
  const f=await authFixture();
  await f.env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('member',0)").run();
  await f.env.DB.prepare("INSERT INTO auth_identities VALUES('fixture-member','member','discord','1553600098661957644',0,0)").run();
  await createSession(f.env,'member');
  const family=await f.env.DB.prepare("SELECT created_at FROM auth_sessions WHERE user_id='member'").first<{created_at:number}>();assert.ok(family);
  const actor={userId:'member',authenticatedAt:family.created_at};
  const input:AdminAction={action:'refresh-membership',scope:'app',discordId:'1553600098661957644',reason:'retry external verification'};
  const preview=await previewAdminAction(f.env,actor,'a',input);
  return {...f,actor,input,confirmation:{previewToken:preview.previewToken,expectedVersion:preview.version,idempotencyKey:'refresh-retry'}};
}
test('failed external role refresh is explicit and same key can resume exactly once',async t=>{
  const f=await refreshOperationFixture();t.after(f.dispose);let calls=0;
  const DB=new Proxy(f.env.DB,{get(target,key){
    if(key==='prepare')return(sql:string)=>{const prepared=target.prepare(sql);if(sql.startsWith('SELECT checked_at FROM memberships'))return {bind(...values:unknown[]){const bound=prepared.bind(...values);return {async first(){calls++;throw new Error('fixture external stage read failure');},all:bound.all.bind(bound),run:bound.run.bind(bound)}}};return prepared;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const failed=await commitAdminAction({...f.env,DB},f.actor,'a',f.input,f.confirmation);
  assert.equal(failed.result,'unavailable');assert.notEqual(failed.result,'applied');assert.equal(calls,1);
  // A crashed running owner has no live claim; the same intent is resumable.
  await f.env.DB.prepare("UPDATE admin_operations SET result='pending-refresh',execution_until=0 WHERE id=?").bind(failed.id).run();
  const [one,two]=await Promise.all([commitAdminAction(f.env,f.actor,'a',f.input,f.confirmation),commitAdminAction(f.env,f.actor,'a',f.input,f.confirmation)]);
  assert.equal(one.id,failed.id);assert.equal(two.id,failed.id);
  const row=await f.env.DB.prepare('SELECT result FROM admin_operations WHERE id=?').bind(failed.id).first<{result:string}>();assert.equal(row?.result,'reauth-required');
});
test('force refresh owns causal receipts and excludes an interleaved unrelated app action',async t=>{
  const f=await refreshOperationFixture();t.after(f.dispose);let injected=false;
  const DB=new Proxy(f.env.DB,{get(target,key){
    if(key==='prepare')return(sql:string)=>{const prepared=target.prepare(sql);if(sql.startsWith('SELECT checked_at FROM memberships'))return {bind(...values:unknown[]){const bound=prepared.bind(...values);return {async first(){if(!injected){injected=true;await target.prepare("UPDATE applications SET status='disabled' WHERE client_id='b'").run();}return bound.first();},all:bound.all.bind(bound),run:bound.run.bind(bound)}}};return prepared;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const operation=await commitAdminAction({...f.env,DB},f.actor,'a',f.input,f.confirmation);
  assert.equal(operation.result,'reauth-required');assert.equal(injected,true);
  assert.equal(operation.delivery.receipts.some(r=>r.client_id==='b'),false);
  assert.equal(operation.delivery.receipts.some(r=>r.client_id==='a'),true);
});

test('a completed refresh operation can retry failed control publication without repeating OAuth work',async t=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const bundle=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});
  const f=await authFixture(bundle.outputFiles[0].text,{jwk:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey)),kid:'retry'});t.after(f.dispose);
  await f.env.DB.prepare("INSERT OR IGNORE INTO applications VALUES('nakwol-connect-admin','Admin','[]','active',0,0)").run();
  await f.env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('member',0)").run();
  await f.env.DB.prepare("INSERT INTO auth_identities VALUES('identity','member','discord','1553600098661957644',0,0)").run();
  await createSession(f.env,'member');
  await f.env.DB.prepare("INSERT INTO access_tokens VALUES(?,'member','nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url('retry-operator'),Date.now()+3600000,Date.now()).run();
  const req=(path:string,body:unknown)=>f.dispatchFetch('https://auth.test'+path,{method:'POST',headers:{Origin:'https://auth.test',Authorization:'Bearer retry-operator','Content-Type':'application/json'},body:JSON.stringify(body)});
  const body={action:'refresh-membership',scope:'app',discordId:'1553600098661957644',reason:'publication retry fixture'};
  const preview=await(await req('/admin/api/operations/a/preview',body)).json<{previewToken:string;version:number}>();
  const response=await req('/admin/api/operations/a',{...body,previewToken:preview.previewToken,expectedVersion:preview.version,idempotencyKey:'publication-retry'});assert.equal(response.status,200);
  const result=await response.json<{id:string;result:string;delivery:{status:string}}>();assert.equal(result.result,'reauth-required');assert.equal(result.delivery.status,'published');
  await f.env.DB.prepare("UPDATE gate_control_outbox SET status='failed',published_at=NULL WHERE seq IN (SELECT control_seq FROM admin_operation_deliveries WHERE operation_id=?)").bind(result.id).run();
  const retried=await req('/admin/api/operations/a/'+result.id+'/retry',{reason:'retry failed publication'});assert.equal(retried.status,200);
  const final=await retried.json<{result:string;delivery:{status:string}}>();assert.equal(final.result,'reauth-required');assert.equal(final.delivery.status,'published');
});
