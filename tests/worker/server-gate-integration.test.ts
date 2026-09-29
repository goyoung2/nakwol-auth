import test from 'node:test';
import assert from 'node:assert/strict';
import {authFixture} from '../helpers/auth-d1';
import app from '../../src/index';
import {registerServerSessionRoutes} from '../../src/server-session-routes';
import {issueSiteCredential} from '../../src/site-credentials';
import {createSession,upsertMembership} from '../../src/store';
import {saveAuthPolicy} from '../../src/auth-policy-settings';
registerServerSessionRoutes(app);

test('generated Pages runtime and real AUTH D1 preserve SSO, renew after one hour, and revoke locally',async t=>{
 const f=await authFixture();t.after(f.dispose);
 const originalFetch=globalThis.fetch, originalNow=Date.now;let now=originalNow(),remote=0;
 t.after(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;});Date.now=()=>now;
 await f.env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES ('member',?)").bind(now).run();
 await upsertMembership(f.env,'member',true,'member',['season3']);
 for(const client of ['a','b'])await f.env.DB.prepare('UPDATE applications SET redirect_uris=? WHERE client_id=?').bind(JSON.stringify([`https://${client}.test/__nakwol/callback`]),client).run();
 const central=await createSession(f.env,'member');
 const adapter=await import(new URL('../../packages/connect-cli/src/adapters/cloudflare-pages.mjs',import.meta.url).href);
 const sites=[];
 globalThis.fetch=async(input,init)=>{remote++;return app.request(new Request(input,init),{},f.env);};
 for(const clientId of ['a','b']){
  const origin=`https://${clientId}.test`, credential=await issueSiteCredential(f.env,'member',clientId,origin,'fixture setup');
  const generated=await adapter.generate({settings:{clientId,siteUrl:origin+'/',authOrigin:'https://auth.test',accessPolicy:'member'},projectName:clientId},{directory:'dist'});
  const module=await import('data:text/javascript;base64,'+Buffer.from(generated['dist/_worker.js']).toString('base64'));
  const env={NAKWOL_SESSION_SECRET:'fixture-cookie-secret-at-least-32-chars',NAKWOL_SITE_CREDENTIAL:credential.secret,ASSETS:{fetch:()=>new Response('PRIVATE-CANARY',{headers:{ETag:'fixture'}})}};
  const serve=(path:string,init:RequestInit={})=>module.default.fetch(new Request(origin+path,init),env);
  for(const path of ['/','/image.webp','/data.json'])assert.equal((await serve(path)).status,401);
  const start=await serve('/__nakwol/start?return_to='+encodeURIComponent('/deck?id=3#detail'));
  assert.equal(start.status,302);const stateCookie=start.headers.get('Set-Cookie').split(';')[0];
  const authorize=await app.request(start.headers.get('Location'),{headers:{Cookie:'nakwol_sid='+central.token}},f.env);
  assert.equal(authorize.status,302);assert.ok(authorize.headers.get('Location')?.startsWith(origin+'/__nakwol/callback?code='));
  const callback=await serve(new URL(authorize.headers.get('Location')!).pathname+new URL(authorize.headers.get('Location')!).search,{headers:{Cookie:stateCookie}});
  assert.equal(callback.status,303,await callback.clone().text());assert.equal(callback.headers.get('Location'),'/deck?id=3#detail');
  const cookies=callback.headers.getSetCookie().filter((v:string)=>!v.startsWith('__Host-nakwol_state_')).map((v:string)=>v.split(';')[0]);
  assert.equal(cookies.length,2);assert.ok(cookies.every((v:string)=>v.length<4096));
  sites.push({serve,cookies,clientId});
 }
 assert.equal(remote,2);
 const a=sites[0],b=sites[1];assert.ok(a&&b);
 const cookie=a.cookies.join('; '),before=remote;
 const images=await Promise.all(Array.from({length:300},()=>a.serve('/image.webp',{headers:{Cookie:cookie}})));
 assert.ok(images.every(r=>r.status===200));assert.equal(remote,before);
 now+=3600001;
 const refreshed=await a.serve('/image.webp',{headers:{Cookie:cookie}});
 assert.equal(refreshed.status,200);assert.equal(remote,before+1);
 assert.equal(refreshed.headers.getSetCookie().length,1);assert.ok(refreshed.headers.get('Set-Cookie').startsWith('__Host-nakwol_proof='));
 const logout=await a.serve('/__nakwol/logout',{method:'POST',headers:{Origin:'https://a.test',Cookie:cookie}});
 assert.equal(logout.status,204);
 assert.equal((await a.serve('/image.webp',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await b.serve('/data.json',{headers:{Cookie:b.cookies.join('; ')}})).status,200);
 // A tighter lifetime is durable even if the application never visits before it is relaxed.
 const saved=await saveAuthPolicy(f.env,{actor:'member',clientId:'b',expectedVersion:0,patch:{sessionIdleSeconds:3600,sessionAbsoluteSeconds:3600},reason:'tighten'});
 await saveAuthPolicy(f.env,{actor:'member',clientId:'b',expectedVersion:saved.policyVersion,patch:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:7200},reason:'relax'});
 now+=300001;
 assert.equal((await b.serve('/data.json',{headers:{Cookie:b.cookies.join('; ')}})).status,401);
});
