import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authFixture} from '../helpers/auth-d1';
import {createSession} from '../../src/store';
import {sha256Base64Url} from '../../src/crypto';
import {Hono} from 'hono';
import {registerDeveloperSetupRoutes} from '../../src/developer-setup';

async function fixture(){const bundle=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});const f=await authFixture(bundle.outputFiles[0].text);for(const id of ['owner-a','owner-b']){await f.env.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();await createSession(f.env,id);await f.env.DB.prepare("INSERT INTO access_tokens VALUES(?,?,'nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url(id),id,Date.now()+3600000,Date.now()).run();await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES(?,'developer','active',0,0)").bind(id).run();await f.env.DB.prepare("INSERT INTO application_owners VALUES(?,?,'owner',0)").bind(id.at(-1),id).run();}
 const req=(path:string,body?:unknown,actor='owner-a',method='POST')=>f.dispatchFetch('https://auth.test'+path,{method:body===undefined?'GET':method,headers:{Authorization:'Bearer '+actor,Origin:'https://auth.test','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {...f,req};}
const setup=()=>({schemaVersion:1,clientId:'a',siteOrigin:'https://site.test',provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:0,policyVersion:0,step:'hosting',idempotencyKey:'11111111-1111-4111-8111-111111111111'});
async function data(r:Response){const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;}
test('setup resume is actor/app scoped, replay-safe and never claims deployment or authenticated acceptance',async t=>{const f=await fixture();t.after(f.dispose);const base='/developer/v1/apps/a/setup';const body={setup:setup(),expectedVersion:0,reason:'initial setup draft'};const saved=await data(await f.req(base,body));assert.equal(saved.version,1);assert.equal(saved.deployment,'unverified');assert.equal(saved.acceptance,'unverified');assert.equal((await data(await f.req(base,body))).version,1);assert.equal((await f.req('/developer/v1/apps/b/setup/'+setup().idempotencyKey,undefined,'owner-b')).status,404);
 await f.env.DB.prepare("INSERT INTO application_owners VALUES('a','owner-b','owner',0)").run();assert.equal((await f.req(base+'/'+setup().idempotencyKey,undefined,'owner-b')).status,404);
 const next={...body,expectedVersion:1,setup:{...setup(),step:'presentation'}};const results=await Promise.all([f.req(base,next),f.req(base,{...next,setup:{...next.setup,step:'policy'}})]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();assert.equal((await f.req(base+'/'+setup().idempotencyKey)).status,403);
});
test('fixed-id app creation cannot suffix or duplicate on repeated and simultaneous setup requests',async t=>{const f=await fixture();t.after(f.dispose);const body={clientId:'wizard-app',name:'Wizard app',siteOrigin:'https://site.test',idempotencyKey:crypto.randomUUID(),reason:'create selected service'};const results=await Promise.all([f.req('/developer/v1/setup/apps',body),f.req('/developer/v1/setup/apps',body)]);for(const r of results)assert.equal((await data(r)).clientId,'wizard-app');assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM applications WHERE client_id LIKE 'wizard-app%'").first<{n:number}>())?.n,1);assert.equal((await f.req('/developer/v1/setup/apps',{...body,name:'different'})).status,409);assert.equal((await f.req('/developer/v1/setup/apps',{...body,idempotencyKey:crypto.randomUUID()},'owner-b')).status,409);});
test('stale capability/configuration and premature verified state cannot be saved',async t=>{const f=await fixture();t.after(f.dispose);await f.env.DB.prepare("INSERT INTO auth_policy_settings VALUES('global',8,?,'owner-a',0)").bind(JSON.stringify({leaseSeconds:60})).run();const body={setup:setup(),expectedVersion:0,reason:'stale policy snapshot'};assert.equal((await f.req('/developer/v1/apps/a/setup',body)).status,409);assert.equal((await f.req('/developer/v1/apps/a/setup',{...body,setup:{...setup(),policyVersion:8,secret:'no'}})).status,400);});
test('credential delivery is one-time and resume cannot create another credential or export a secret',async t=>{const f=await fixture();t.after(f.dispose);const document=setup();await data(await f.req('/developer/v1/apps/a/setup',{setup:document,expectedVersion:0,reason:'prepare credential setup'}));const endpoint='/developer/v1/apps/a/setup/'+document.idempotencyKey+'/credential',body={expectedVersion:1,reason:'enable server refresh'};const first=await data(await f.req(endpoint,body));assert.ok(first.secret);const replay=await data(await f.req(endpoint,body));assert.equal(replay.credentialId,first.credentialId);assert.equal(replay.secret,undefined);assert.equal(replay.secretAvailable,false);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM site_credentials WHERE client_id='a'").first<{n:number}>())?.n,1);const resumed=await data(await f.req('/developer/v1/apps/a/setup/'+document.idempotencyKey));assert.ok(!JSON.stringify(resumed).includes(first.secret));});
test('every stage resumes through authenticated CLI and shares the exact portable validator',async t=>{
 const f=await fixture();t.after(f.dispose);const key=setup().idempotencyKey;let revision=0;
 await f.env.DB.prepare("INSERT INTO connect_cli_tokens VALUES(?,'owner-a','[\"connect:apps\"]',?,NULL,?,?)").bind(await sha256Base64Url('cli-fixture'),Date.now()+3600000,Date.now(),Date.now()).run();
 for(const step of ['hosting','presentation','policy','review','install','verify']){
  const saved=await data(await f.req('/developer/v1/apps/a/setup',{setup:{...setup(),step},expectedVersion:revision,reason:'resume each stage'}));revision=saved.version;
  const resumed=await data(await f.dispatchFetch('https://auth.test/connect/cli/apps/a/setup/'+key,{headers:{Authorization:'Bearer cli-fixture'}}));assert.equal(resumed.setup.step,step);assert.equal(resumed.deployment,'unverified');
 }
 assert.equal((await f.dispatchFetch('https://auth.test/connect/cli/apps/a/setup/'+key)).status,401);
 const source=await (await f.dispatchFetch('https://auth.test/presentation/v1/setup-schema.mjs')).text();
 const {readFile}=await import('node:fs/promises');assert.equal(source,await readFile('packages/connect-cli/src/shared/setup-schema.mjs','utf8'));
 const {parseSetup}=await import('../../packages/connect-cli/src/shared/setup-schema.mjs');
 for(const patch of [{secret:'private'},{step:'complete'},{provider:'github-pages'}]){
  let code='';try{parseSetup({...setup(),...patch});}catch(error){if(error instanceof Error)code=error.message.split(':')[0];}
  const response=await f.req('/developer/v1/apps/a/setup',{setup:{...setup(),...patch},expectedVersion:revision,reason:'invalid shared schema'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,code);
 }
 await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();assert.equal((await f.dispatchFetch('https://auth.test/connect/cli/apps/a/setup/'+key,{headers:{Authorization:'Bearer cli-fixture'}})).status,403);
});
test('simultaneous credential requests deliver exactly once and cannot retarget an issued setup',async t=>{
 const f=await fixture();t.after(f.dispose);await data(await f.req('/developer/v1/apps/a/setup',{setup:setup(),expectedVersion:0,reason:'prepare concurrent delivery'}));
 const endpoint='/developer/v1/apps/a/setup/'+setup().idempotencyKey+'/credential';
 const results=await Promise.all([f.req(endpoint,{expectedVersion:1,reason:'concurrent issue'}).then(data),f.req(endpoint,{expectedVersion:1,reason:'concurrent issue'}).then(data)]);
 assert.equal(results.filter(r=>r.secret).length,1);assert.equal(results[0].credentialId,results[1].credentialId);
 const changed=await f.req('/developer/v1/apps/a/setup',{setup:{...setup(),siteOrigin:'https://other.test'},expectedVersion:1,reason:'retarget old credential'});assert.equal(changed.status,409);
 assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM site_credentials WHERE client_id='a'").first<{n:number}>())?.n,1);
 const raw=await f.dispatchFetch('https://auth.test'+endpoint,{method:'POST',headers:{Authorization:'Bearer owner-a',Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({expectedVersion:1,reason:'invalid origin'})});assert.equal(raw.status,403);
 await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='owner-a'").bind(Date.now()-1000000).run();assert.equal((await f.req(endpoint,{expectedVersion:1,reason:'old authentication'})).status,403);
});
test('credential committed between origin precheck and CAS cannot strand the setup',async t=>{
 const f=await fixture();t.after(f.dispose);await data(await f.req('/developer/v1/apps/a/setup',{setup:setup(),expectedVersion:0,reason:'race setup'}));
 let injected=false;
 const DB=new Proxy(f.env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>{const statement=target.prepare(sql);if(sql!=='SELECT 1 FROM service_setup_credentials WHERE setup_id=?')return statement;
   return new Proxy(statement,{get(s,method){if(method==='bind')return (...values:unknown[])=>{const bound=s.bind(...values);return new Proxy(bound,{get(b,operation){if(operation==='first')return async()=>{const prior=await b.first();if(!injected){injected=true;await data(await f.req('/developer/v1/apps/a/setup/'+setup().idempotencyKey+'/credential',{expectedVersion:1,reason:'race issue'}));}return prior;};const member=Reflect.get(b,operation);return typeof member==='function'?member.bind(b):member;}});};const member=Reflect.get(s,method);return typeof member==='function'?member.bind(s):member;}});};
  const member=Reflect.get(target,key);return typeof member==='function'?member.bind(target):member;
 }});
 const app=new Hono();registerDeveloperSetupRoutes(app);
 const response=await app.request('https://auth.test/developer/v1/apps/a/setup',{method:'POST',headers:{Authorization:'Bearer owner-a',Origin:'https://auth.test','Content-Type':'application/json'},body:JSON.stringify({setup:{...setup(),siteOrigin:'https://other.test'},expectedVersion:1,reason:'race origin update'})},{...f.env,DB});
 assert.equal(injected,true);assert.equal(response.status,409);assert.equal((await data(await f.req('/developer/v1/apps/a/setup/'+setup().idempotencyKey))).setup.siteOrigin,'https://site.test');
});
