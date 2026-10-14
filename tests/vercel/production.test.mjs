import { migrationStatements } from '../worker/migration-statements.ts';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {handleRequest} from '../../deploy/vercel-auth-production/runtime/auth-runtime.mjs';
import {inspectProduction,callbackStatements,bridgeConfiguration,oldOrigin,canaryDatabase} from '../../scripts/vercel-production-plan.mjs';
const require=createRequire(new URL('../../deploy/vercel-auth-test/package.json',import.meta.url));const {Miniflare}=require('miniflare');
const origin='https://auth.production.example';const databaseId='11111111-1111-4111-8111-111111111111';
const secret='local-production-fixture-secret-0123456789012345';
const endpoint='https://private-db.example/rpc';
const env={NAKWOL_AUTH_MODE:'production',VERCEL_ENV:'production',AUTH_ORIGIN:origin,D1_BRIDGE_DATABASE_ID:databaseId,D1_BRIDGE_URL:endpoint,D1_BRIDGE_SECRET:secret,DISCORD_CLIENT_ID:'1541341243576033330',DISCORD_CLIENT_SECRET:'local-oauth-fixture-only',NAKWOL_GUILD_ID:'1493410906456064112',NAKWOL_MEMBER_ROLE_ID:'1553600098661957643'};
const pending=[];const ctx={waitUntil(p){pending.push(p);},passThroughOnException(){},props:{}};
let mf,native,url,Database,transport,db;
const hash=v=>createHash('sha256').update(v).digest('base64url');
const request=(path,options={},values=env)=>handleRequest(new Request(origin+path,options),values,ctx,transport);
before(async()=>{
 const built=await build({entryPoints:['adapters/vercel/d1-http.ts'],bundle:true,platform:'node',format:'esm',write:false});({HttpD1Database:Database}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')));
 mf=new Miniflare({modules:true,scriptPath:'deploy/vercel-auth-production/bridge-worker.mjs',compatibilityDate:'2026-07-01',d1Databases:{DB:'production-local-only'},bindings:{D1_BRIDGE_SECRET:secret,NAKWOL_D1_BRIDGE_MODE:'production',NAKWOL_D1_BRIDGE_DATABASE_ID:databaseId},port:0});url=await mf.ready;native=await mf.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){const sql=await readFile('migrations/'+name,'utf8');for(const line of migrationStatements(sql))await native.prepare(line).run();}
 transport=(_url,init)=>fetch(new URL('/rpc',url),init);db=new Database(endpoint,secret,transport,databaseId);
 const now=Date.now();
 for(const [id,discord,roles]of [['existing-member','123456789012345678',[env.NAKWOL_MEMBER_ROLE_ID]],['existing-outsider','223456789012345678',[]]]){
  await native.prepare("INSERT INTO users(id,display_name,status,created_at,updated_at) VALUES(?,?,'active',?,?)").bind(id,id,now,now).run();
  await native.prepare("INSERT INTO auth_identities VALUES(?,?,'discord',?,?,?)").bind('identity-'+id,id,discord,now,now).run();
  await native.prepare("INSERT INTO memberships(user_id,guild_id,is_guild_member,role,status,checked_at,role_ids) VALUES(?,?,1,?,?,?,?)").bind(id,env.NAKWOL_GUILD_ID,roles.length?'member':'user',roles.length?'active':'inactive',now,JSON.stringify(roles)).run();
 }
 await native.prepare("INSERT INTO applications VALUES('external-service','Existing Service','[\"https://service.example/\"]','active',?,?)").bind(now,now).run();
 await native.prepare("INSERT INTO application_settings(client_id,framework,access_policy,created_at,updated_at) VALUES('external-service','other','member',?,?)").bind(now,now).run();
 for(const id of ['existing-member','existing-outsider'])await native.prepare('INSERT OR IGNORE INTO access_tokens VALUES(?,?,?,?,NULL,?)').bind(hash('token-'+id),id,'external-service',now+3600000,now).run();
 await native.prepare("INSERT INTO auth_operators(user_id,role,created_at) VALUES('existing-member','operator',?)").bind(now).run();
});
after(async()=>{await Promise.allSettled(pending);await mf.dispose();});
test('production rejects preview target, canary DB, bad authority and forwarded-host spoof before any SQL',async()=>{
 let calls=0;const blockedTransport=async()=>{calls++;throw new Error('must not run');};
 for(const changes of [{VERCEL_ENV:'preview'},{NAKWOL_VERCEL_CANARY:'true'},{D1_BRIDGE_DATABASE_ID:canaryDatabase},{D1_BRIDGE_DATABASE_ID:'bad'},{AUTH_ORIGIN:'http://auth.example'},{AUTH_ORIGIN:origin+'/'},{AUTH_ORIGIN:'https://nakwol-auth-vercel-test.vercel.app'}]){const response=await handleRequest(new Request(origin+'/me'),{...env,...changes},ctx,blockedTransport);assert.equal(response.status,503);}
 assert.equal((await handleRequest(new Request('https://unregistered.example/me',{headers:{'X-Forwarded-Host':new URL(origin).host}}),env,ctx,blockedTransport)).status,503);assert.equal(calls,0);
});
test('missing credentials and wrong guild/season fail closed locally; status contains no credentials or IDs',async()=>{
 for(const changes of [{DISCORD_CLIENT_SECRET:''},{DISCORD_CLIENT_ID:'invalid'},{NAKWOL_GUILD_ID:'wrong'},{NAKWOL_MEMBER_ROLE_ID:'wrong'}]){assert.equal((await request('/me',{}, {...env,...changes})).status,503);const r=await request('/deployment/status',{}, {...env,...changes});assert.equal((await r.json()).configuration_ready,false);}
 const payload=await (await request('/deployment/status')).text();assert.ok(!payload.includes(secret));assert.ok(!payload.includes(databaseId));
});
test('existing application tokens preserve member allow/nonmember deny and wrong app binding',async()=>{
 for(const [id,status]of [['existing-member',200],['existing-outsider',403]]){const r=await request('/me?client_id=external-service',{headers:{Origin:'https://service.example',Authorization:'Bearer token-'+id}});assert.equal(r.status,status,await r.clone().text());if(status===200)assert.equal((await r.json()).data.id,id);}
 assert.equal((await request('/me?client_id=nakwol-connect-admin',{headers:{Origin:oldOrigin,Authorization:'Bearer token-existing-member'}})).status,401);
 for(const method of ['GET','HEAD']){const r=await request('/me?client_id=external-service',{method,headers:{Origin:'https://service.example'}});assert.equal(r.status,401);assert.match(r.headers.get('cache-control'),/no-store/);}
 assert.equal((await request('/me?client_id=external-service',{headers:{Origin:'https://service.example',Authorization:'Bearer token-existing-member',Range:'bytes=0-1'}})).status,200);
});
test('production private bridge requires exact DB pin and rejects DDL before executing it',async()=>{
 const body=JSON.stringify({method:'run',statement:{query:'DROP TABLE users',params:[]}});
 for(const [pin,status]of [[undefined,403],[canaryDatabase,403],[databaseId,400]]){const r=await fetch(new URL('/rpc',url),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json',...(pin?{'X-Nakwol-Database-ID':pin}:{})},body});assert.equal(r.status,status);assert.deepEqual(await r.json(),{ok:false});}
 for (const query of ['SELECT 1; DROP TABLE users', 'WITH x AS (SELECT 1) SELECT * FROM x; DELETE FROM users']) {
  const r=await fetch(new URL('/rpc',url),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json','X-Nakwol-Database-ID':databaseId},body:JSON.stringify({method:'run',statement:{query,params:[]}})});assert.equal(r.status,400);
 }
 assert.equal(await db.prepare('SELECT ? AS value').bind('bound;value').first('value'),'bound;value');
 assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'),2);
 const canaryClient=new Database(endpoint,secret,transport);await assert.rejects(canaryClient.prepare('SELECT 1').first(),/D1_BRIDGE_UNAVAILABLE/);
});
test('same existing member identity completes OAuth/PKCE without creating duplicate user/operator',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{const path=String(input);if(path==='https://discord.com/api/oauth2/token'){assert.equal(new URLSearchParams(init.body).get('redirect_uri'),origin+'/auth/discord/callback');return Response.json({access_token:'mock-external-discord'});}if(path.endsWith('/users/@me'))return Response.json({id:'123456789012345678',username:'existing-member',avatar:null});if(path.endsWith('/member'))return Response.json({roles:[env.NAKWOL_MEMBER_ROLE_ID]});return original(input,init);};
 try{
  const verifier='existing-member-verifier-0123456789012345678901234567890123456789';const challenge=hash(verifier);
  const authorize=await request('/authorize?'+new URLSearchParams({client_id:'external-service',redirect_uri:'https://service.example/',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'state'}));assert.equal(authorize.status,302);
  const state=new URL(authorize.headers.get('location')).searchParams.get('state');
  const callback=await request('/auth/discord/callback?'+new URLSearchParams({code:'discord-code',state}));assert.equal(callback.status,302);assert.match(callback.headers.get('set-cookie'),/HttpOnly/);assert.match(callback.headers.get('set-cookie'),/Secure/);
  const code=new URL(callback.headers.get('location')).searchParams.get('code');
  const token=await request('/token?client_id=external-service',{method:'POST',headers:{Origin:'https://service.example','Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:'external-service',redirect_uri:'https://service.example/',code,code_verifier:verifier})});assert.equal(token.status,200,await token.clone().text());
  const r=await request('/me?client_id=external-service',{headers:{Origin:'https://service.example',Authorization:'Bearer '+(await token.json()).access_token}});assert.equal((await r.json()).data.id,'existing-member');
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'),2);assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM auth_operators').first('n'),1);
 }finally{globalThis.fetch=original;}
});
test('DB outage and wrong DB pin cannot authorize an existing member token',async()=>{
 const failed=async()=>new Response('{"ok":false}',{status:503});const r=await handleRequest(new Request(origin+'/me?client_id=external-service',{headers:{Origin:'https://service.example',Authorization:'Bearer token-existing-member'}}),env,ctx,failed);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:{code:'AUTH_DEPENDENCY_UNAVAILABLE'}});
 assert.equal((await request('/me?client_id=external-service',{headers:{Origin:'https://service.example',Authorization:'Bearer token-existing-member'}},{...env,D1_BRIDGE_DATABASE_ID:'22222222-2222-4222-8222-222222222222'})).status,503);
});
async function inspection(){
 const apps=(await db.prepare("SELECT client_id,status,redirect_uris FROM applications WHERE client_id IN ('nakwol-auth-selftest','nakwol-connect-admin','nakwol-connect-cli','nakwol-account-center')").all()).results;
 const schema=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' UNION ALL SELECT 'oauth_requests.'||name FROM pragma_table_info('oauth_requests') WHERE name='diagnostic_ref'").all()).results;
 return {accountId:'a'.repeat(32),origin,worker:{id:'fixture-version',resources:{bindings:[{name:'AUTH_ORIGIN',type:'plain_text',text:oldOrigin},{name:'DB',type:'d1',id:databaseId},{name:'DISCORD_CLIENT_ID',type:'plain_text',text:env.DISCORD_CLIENT_ID},{name:'DISCORD_CLIENT_SECRET',type:'secret_text'},{name:'NAKWOL_GUILD_ID',type:'plain_text',text:env.NAKWOL_GUILD_ID},{name:'NAKWOL_MEMBER_ROLE_ID',type:'plain_text',text:env.NAKWOL_MEMBER_ROLE_ID}]}},databases:[{uuid:databaseId,name:'nakwol-auth'}],schema,apps,counts:{users:2,operators:1,applications:apps.length,grants:0}};
}
test('callback additions and targeted rollback preserve original callbacks, policies, identities and unrelated edits',async()=>{
 const input=await inspection(),profile=inspectProduction(input);assert.equal(profile.missingSchema.length,0);assert.equal(profile.additions.length,5);
 const before=(await db.prepare('SELECT client_id,redirect_uris FROM applications ORDER BY client_id').all()).results;
 const policies=(await db.prepare('SELECT * FROM application_settings ORDER BY client_id').all()).results;
 const exec=action=>db.batch(callbackStatements(profile,action).map(s=>db.prepare(s.query).bind(...s.params)));
 await exec('add');const repeated=await exec('add');assert.ok(repeated.every(r=>r.meta.changes===0));
 for(const {clientId,uri}of profile.additions){const list=JSON.parse(await db.prepare('SELECT redirect_uris FROM applications WHERE client_id=?').bind(clientId).first('redirect_uris'));assert.ok(list.includes(uri));}
 await db.prepare("UPDATE applications SET redirect_uris=json_insert(redirect_uris,'$[#]','https://other.example/admin') WHERE client_id='nakwol-connect-admin'").run();
 await exec('remove');
 for(const row of before){const list=JSON.parse(await db.prepare('SELECT redirect_uris FROM applications WHERE client_id=?').bind(row.client_id).first('redirect_uris'));for(const old of JSON.parse(row.redirect_uris))assert.ok(list.includes(old));}
 assert.ok(JSON.parse(await db.prepare("SELECT redirect_uris FROM applications WHERE client_id='nakwol-connect-admin'").first('redirect_uris')).includes('https://other.example/admin'));
 assert.deepEqual((await db.prepare('SELECT * FROM application_settings ORDER BY client_id').all()).results,policies);assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'),2);assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM auth_operators').first('n'),1);
});
test('read-only preparation rejects wrong DB/origin/policy and reports absent schema rather than creating it',async()=>{
 const input=await inspection();
 assert.throws(()=>inspectProduction({...input,databases:[{name:'nakwol-auth-vercel-test',uuid:databaseId}]}),/WRONG_PRODUCTION_DATABASE/);
 assert.throws(()=>inspectProduction({...input,origin:'https://nakwol-auth-vercel-test.vercel.app'}),/INVALID_PRODUCTION_ORIGIN/);
 assert.throws(()=>inspectProduction({...input,origin:origin+'/path'}),/INVALID_PRODUCTION_ORIGIN/);
 assert.throws(()=>inspectProduction({...input,apps:input.apps.filter(a=>a.client_id!=='nakwol-connect-admin')}),/INTERNAL_APP_MISSING/);
 const profile=inspectProduction({...input,schema:input.schema.filter(t=>!t.name.startsWith('diagnostic')&&t.name!=='oauth_requests.diagnostic_ref')});assert.equal(profile.missingSchema.length,4);
 const bridge=bridgeConfiguration(profile,'bridge.mjs');assert.equal(bridge.d1_databases[0].database_id,databaseId);assert.equal(bridge.vars.NAKWOL_D1_BRIDGE_MODE,'production');assert.equal('migrations_dir' in bridge.d1_databases[0],false);
 const preexisting=structuredClone(input);preexisting.apps.find(a=>a.client_id==='nakwol-account-center').redirect_uris=JSON.stringify([...JSON.parse(preexisting.apps.find(a=>a.client_id==='nakwol-account-center').redirect_uris),origin+'/account']);const existing=inspectProduction(preexisting);assert.equal(existing.additions.some(a=>a.uri===origin+'/account'),false);
});
test('production diagnostic network keys retain per-network limits without one global six-ticket bucket',async()=>{
 const missingServerFields={...env};const headers={Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'spoofed-client-ip'};
 const issue=key=>handleRequest(new Request(origin+'/diagnostics/tickets?client_id=nakwol-auth-selftest',{method:'POST',headers,body:'{}'}),missingServerFields,ctx,transport,key);
 for(let i=0;i<6;i++)assert.equal((await issue('server-derived-network-one')).status,201);
 assert.equal((await issue('server-derived-network-one')).status,429);assert.equal((await issue('server-derived-network-two')).status,201);
 const guards=(await db.prepare('SELECT guard_hash FROM diagnostic_rate_guards').all()).results;assert.ok(guards.every(g=>g.guard_hash.length===43&&!g.guard_hash.includes('server-derived')));
});
test('real Node production wrapper binds Host, preserves HEAD, and uses server-derived network keys without exposing IP',async()=>{
 const {createServer,request:nodeRequest}=await import('node:http');const {once}=await import('node:events');const {default:handler}=await import('../../deploy/vercel-auth-production/api/index.mjs');
 const before={};for(const [key,value]of Object.entries(env)){before[key]=process.env[key];process.env[key]=value;}const original=globalThis.fetch;
 globalThis.fetch=(input,init)=>String(input)===endpoint?original(new URL('/rpc',url),init):original(input,init);
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();
 const call=(path,{method='GET',host=new URL(origin).host,headers={},body}={})=>new Promise((resolve,reject)=>{const req=nodeRequest('http://127.0.0.1:'+address.port+path,{method,headers:{Host:host,...headers}},res=>{const parts=[];res.on('data',p=>parts.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));});req.on('error',reject);req.end(body);});
 try{
  const denied=await call('/me?client_id=external-service',{headers:{Origin:'https://service.example'}});assert.equal(denied.status,401);assert.match(denied.headers['cache-control'],/no-store/);
  const head=await call('/me?client_id=external-service',{method:'HEAD',headers:{Origin:'https://service.example',Authorization:'Bearer token-existing-member'}});assert.equal(head.status,200);assert.equal(head.body,'');
  const wrong=await call('/deployment/status',{host:'unregistered.example',headers:{'X-Forwarded-Host':new URL(origin).host}});assert.equal(wrong.status,503);
  for(const fake of ['198.51.100.1','198.51.100.2']){const r=await call('/diagnostics/tickets?client_id=nakwol-auth-selftest',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-For':'192.0.2.10','CF-Connecting-IP':fake},body:'{}'});assert.equal(r.status,201);assert.ok(!r.body.includes('192.0.2.10'));}
  const guards=(await native.prepare('SELECT count FROM diagnostic_rate_guards WHERE count=2').all()).results;assert.equal(guards.length,1);
  const report=await native.prepare('SELECT network_json FROM diagnostic_reports ORDER BY created_at DESC LIMIT 1').first('network_json');assert.ok(!report.includes('192.0.2.10'));assert.ok(!report.includes('198.51.100.2'));
 }finally{globalThis.fetch=original;for(const [key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
