import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { authFixture } from '../helpers/auth-d1';
import { createAuthorizationCode,createSession,deleteSession,upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { exchangeServerCode,refreshServerSession,revokeServerSession } from '../../src/server-sessions';
import { issueSiteCredential,revokeSiteCredential } from '../../src/site-credentials';
import { registerServerSessionRoutes } from '../../src/server-session-routes';
import type { Env } from '../../src/types';
import { build } from 'esbuild';

async function setup(script?:string) {
  const fixture=await authFixture(script),{env}=fixture;
  await env.DB.prepare('UPDATE applications SET redirect_uris=? WHERE client_id=?').bind(JSON.stringify(['https://a.test/__nakwol/callback']),'a').run();
  await upsertMembership(env,'member',true,'member',['season3']);
  await env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('member',0)").run();
  await env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_user_id,created_at,updated_at) VALUES('di','member','discord','123',0,0)").run();
  const credential=await issueSiteCredential(env,'member','a','https://a.test','fixture');
  const family=await createSession(env,'member'),verifier='v'.repeat(43);
  const code=await createAuthorizationCode(env,'member','a','https://a.test/__nakwol/callback',await sha256Base64Url(verifier),family.token);
  const binding={clientId:'a',siteOrigin:'https://a.test',credential:credential.secret};
  const exchange={...binding,code,redirectUri:'https://a.test/__nakwol/callback',codeVerifier:verifier};
  return {...fixture,credential,family,exchange,binding};
}
test('300 concurrent refreshes CAS once; stale proof >30 seconds and lost response >300 seconds recover',async t=>{
  const bundled=await build({stdin:{contents:"import {Hono} from 'hono';import {registerServerSessionRoutes} from './src/server-session-routes';const app=new Hono();registerServerSessionRoutes(app);export default app;",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser'});
  const f=await setup(bundled.outputFiles[0].text);t.after(f.dispose);
  const initial=await exchangeServerCode(f.env,f.exchange);
  const args={...f.binding,sessionId:initial.session.sessionId,handle:initial.handle,expectedGeneration:0};
  const results=await Promise.all(Array.from({length:300},async()=>{const response=await f.dispatchFetch('https://auth.test/server/v1/session/refresh',{method:'POST',headers:{Authorization:'Bearer '+f.binding.credential,'Content-Type':'application/json'},body:JSON.stringify({client_id:'a',site_origin:'https://a.test',session_id:args.sessionId,handle:args.handle,expected_generation:0})});
    const result=await response.json<{session:{generation:number}}>();
    assert.equal(response.status,200,JSON.stringify(result));return result;
  }));
  assert.ok(results.every(r=>r.session.generation===1));
  assert.equal((await f.env.DB.prepare('SELECT generation FROM server_sessions').first<{generation:number}>())?.generation,1);
  const before=(await refreshServerSession(f.env,args)).session;
  let now=Date.now()+31000;t.mock.method(Date,'now',()=>now);
  const stale=await refreshServerSession(f.env,args);
  assert.deepEqual(stale.session,before);
  now+=301000;
  const recovered=await refreshServerSession(f.env,args);
  assert.equal(recovered.session.generation,2);
  assert.ok(recovered.session.leaseUntil>now);
  assert.ok(recovered.session.leaseUntil<=now+300000);
  assert.equal('handle' in recovered,false);
  await assert.rejects(refreshServerSession(f.env,{...args,expectedGeneration:99}),/INVALID_GENERATION/);
});
test('code single consume, wrong PKCE/app/origin/credential and unbound code issue nothing',async t=>{
  const f=await setup();t.after(f.dispose);
  for(const bad of [{codeVerifier:'wrong'},{clientId:'b'},{siteOrigin:'https://b.test'},{credential:'wrong'}])
    await assert.rejects(exchangeServerCode(f.env,{...f.exchange,...bad}));
  const results=await Promise.allSettled(Array.from({length:20},()=>exchangeServerCode(f.env,f.exchange)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const code=await createAuthorizationCode(f.env,'member','a',f.exchange.redirectUri,await sha256Base64Url(f.exchange.codeVerifier));
  await assert.rejects(exchangeServerCode(f.env,{...f.exchange,code}),/INVALID_CODE/);
});
test('family logout, credential revoke, idle expiry and absolute expiry are terminal',async t=>{
  for(const action of ['family','credential','idle','absolute'] as const){
    const f=await setup();t.after(f.dispose);const issued=await exchangeServerCode(f.env,f.exchange);
    const args={...f.binding,sessionId:issued.session.sessionId,handle:issued.handle,expectedGeneration:0};
    switch(action){
      case 'family':await deleteSession(f.env,f.family.token);break;
      case 'credential':await revokeSiteCredential(f.env,'member','a',f.credential.credentialId,'fixture');break;
      case 'idle':await f.env.DB.prepare('UPDATE server_sessions SET idle_expires_at=?').bind(Date.now()-1).run();break;
      case 'absolute':await f.env.DB.prepare('UPDATE server_sessions SET absolute_expires_at=?').bind(Date.now()-1).run();break;
    }
    await assert.rejects(refreshServerSession(f.env,args));
  }
});
test('concurrent revoke and deny cannot extend proof beyond verification start plus300 seconds',async t=>{
  const f=await setup();t.after(f.dispose);const issued=await exchangeServerCode(f.env,f.exchange);
  const args={...f.binding,sessionId:issued.session.sessionId,handle:issued.handle,expectedGeneration:0};
  const cutoff=Date.now();
  const race=await Promise.allSettled([refreshServerSession(f.env,args),revokeServerSession(f.env,args)]);
  if(race[0].status==='fulfilled'&&'session' in race[0].value)assert.ok(race[0].value.session.leaseUntil<=cutoff+300100);
  await assert.rejects(refreshServerSession(f.env,args));
  const second=await setup();t.after(second.dispose);const other=await exchangeServerCode(second.env,second.exchange);
  const otherArgs={...second.binding,sessionId:other.session.sessionId,handle:other.handle,expectedGeneration:0};
  await Promise.allSettled([refreshServerSession(second.env,otherArgs),second.env.DB.prepare("INSERT INTO application_access_denies VALUES('app:a','123','active','fixture','member',?,NULL)").bind(Date.now()).run()]);
  await assert.rejects(refreshServerSession(second.env,otherArgs),/DENIED/);
});
test('HTTP server endpoints reject browser Origin and oversized bodies, always no-store',async t=>{
  const f=await setup();t.after(f.dispose);const app=new Hono<{Bindings:Env}>();registerServerSessionRoutes(app);
  for(const [body,origin] of [[JSON.stringify({client_id:'a'}),'https://a.test'],[' '.repeat(8193),'']] as const){
    const headers:Record<string,string>={'Authorization':'Bearer '+f.credential.secret,'Content-Type':'application/json'};
    if(origin)headers.Origin=origin;
    const result=await app.request('/server/v1/code-exchange',{method:'POST',headers,body},f.env);
    assert.equal(result.status,403);assert.equal(result.headers.get('Cache-Control'),'no-store');
  }
  const saved=await f.env.DB.prepare('SELECT secret_hash FROM site_credentials').first<{secret_hash:string}>();
  assert.notEqual(saved?.secret_hash,f.credential.secret);
});
test('credential management checks current ownership, recent auth and CSRF; revoke and audit are scoped',async t=>{
  const f=await setup();t.after(f.dispose);
  await f.env.DB.prepare("INSERT OR IGNORE INTO applications VALUES('nakwol-connect-admin','Admin','[]','active',0,0)").run();
  await f.env.DB.prepare('INSERT INTO access_tokens(token_hash,user_id,client_id,expires_at,created_at) VALUES(?,?,?,?,?)')
    .bind(await sha256Base64Url('management'),'member','nakwol-connect-admin',Date.now()+3600000,Date.now()).run();
  await f.env.DB.prepare("DELETE FROM auth_operators WHERE user_id='member'").run();
  await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES('member','developer','active',0,0)").run();
  await f.env.DB.prepare("INSERT INTO application_owners VALUES('a','member','owner',0)").run();
  const app=new Hono<{Bindings:Env}>();registerServerSessionRoutes(app);
  const request=(path:string,body:unknown,origin='https://auth.test')=>app.request(path,{method:'POST',headers:{Authorization:'Bearer management',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
  const path='/developer/v1/apps/a/site-credentials',body={siteOrigin:'https://a.test',reason:'fixture issue'};
  assert.equal((await request(path,body,'https://evil.test')).status,403);
  assert.equal((await request('/developer/v1/apps/b/site-credentials',{...body,siteOrigin:'https://b.test'})).status,403);
  assert.equal((await request(path,{...body,siteOrigin:'https://unregistered.test'})).status,403);
  await f.env.DB.prepare("UPDATE memberships SET checked_at=? WHERE user_id='member'").bind(Date.now()-900001).run();
  assert.equal((await request(path,body)).status,403);
  await upsertMembership(f.env,'member',true,'member',['season3']);
  const issued=await request(path,body);assert.equal(issued.status,200);
  const data=await issued.json<{data:{credentialId:string;secret:string}}>();
  assert.ok(data.data.secret.length>=43);
  assert.equal((await request(path+'/'+data.data.credentialId+'/revoke',{reason:'fixture revoke'})).status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM site_credential_audit WHERE credential_id=?').bind(data.data.credentialId).first<{n:number}>())?.n,2);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='member'").run();
  assert.equal((await request(path,body)).status,403);
});
