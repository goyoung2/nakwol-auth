import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const standaloneRequire = createRequire(new URL('../../deploy/vercel-auth-test/package.json', import.meta.url));
const { Miniflare } = standaloneRequire('miniflare');
import { build } from 'esbuild';
import { createServer, request as nodeRequest } from 'node:http';
import { once } from 'node:events';
import handler from '../../deploy/vercel-auth-test/api/index.mjs';
import { handleRequest } from '../../deploy/vercel-auth-test/runtime/auth-runtime.mjs';

const origin = 'https://nakwol-auth-vercel-test.vercel.app';
const secret = 'canary-test-only-secret-01234567890123456789';
const endpoint = 'https://bridge.test/rpc';
const values = { NAKWOL_VERCEL_CANARY: 'true', AUTH_ORIGIN: origin, D1_BRIDGE_URL: endpoint, D1_BRIDGE_SECRET: secret, DISCORD_CLIENT_ID: 'discord-test-app', DISCORD_CLIENT_SECRET: 'test-only-discord-secret', NAKWOL_GUILD_ID: '1493410906456064112', NAKWOL_MEMBER_ROLE_ID: '1553600098661957643' };
let mf, db, localUrl, HttpD1Database;
const pending = [];
const ctx = { waitUntil(p) { pending.push(p); }, passThroughOnException() {}, props: {} };
const transport = async (_url, init) => fetch(new URL('/rpc', localUrl), init);
const request = (path, options = {}, env = values) => handleRequest(new Request(origin + path, options), env, ctx, transport);
before(async () => {
  const compiled = await build({ entryPoints: ['adapters/vercel/d1-http.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  ({ HttpD1Database } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')));
  mf = new Miniflare({ workers: [{ name: 'bridge', modules: true, scriptPath: 'deploy/vercel-auth-test/bridge-worker.mjs', compatibilityDate: '2026-07-01', d1Databases: { DB: 'canary-test' }, bindings: { D1_BRIDGE_SECRET: secret, NAKWOL_D1_TEST_BRIDGE: 'true' } }], port: 0 });
  localUrl = await mf.ready;
  const native = await mf.getD1Database('DB');
  for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) {
    const sql = await readFile('migrations/' + name, 'utf8');
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await native.prepare(statement).run();
  }
  const bootstrap = (await readFile('deploy/vercel-auth-test/bootstrap.sql.template', 'utf8')).replaceAll('__AUTH_ORIGIN__', origin);
  for (const statement of bootstrap.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)) await native.prepare(statement).run();
  db = new HttpD1Database(endpoint, secret, transport);
});
after(async () => { await Promise.allSettled(pending); await mf?.dispose(); });

test('bridge accepts only authenticated exact POST path, no CORS or SQL disclosure', async () => {
  for (const [path, method, auth, status] of [['/rpc','GET',secret,404],['/other','POST',secret,404],['/rpc?x=1','POST',secret,404],['/rpc','POST','wrong',401]]) {
    const response = await fetch(new URL(path, localUrl), { method, headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    assert.equal(response.status,status); assert.equal(response.headers.has('Access-Control-Allow-Origin'),false);
  }
  const response = await fetch(new URL('/rpc', localUrl), { method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({method:'all',statement:{query:'SELECT secret_column FROM nonexistent_private_table',params:[]}}) });
  assert.equal(response.status,503); assert.deepEqual(await response.json(),{ok:false});
});

test('bridge enforces streamed body, query, parameter and batch limits before execution', async () => {
  const call = async body => fetch(new URL('/rpc', localUrl), {method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body});
  assert.equal((await call(' '.repeat(262145))).status,413);
  assert.equal((await call(JSON.stringify({method:'run',statement:{query:' '.repeat(16385)+'SELECT 1',params:[]}}))).status,400);
  assert.equal((await call(JSON.stringify({method:'batch',statements:Array.from({length:65},()=>({query:'SELECT 1',params:[]}))}))).status,400);
  assert.equal((await call(JSON.stringify({method:'run',statement:{query:'SELECT 1',params:Array(101).fill(1)}}))).status,400);
});

test('D1 prepare/bind/first/all/run/raw/exec forward real D1 results and binary values', async () => {
  await db.exec('CREATE TABLE bridge_values (id INTEGER PRIMARY KEY, label TEXT, bytes BLOB)');
  const run = await db.prepare('INSERT INTO bridge_values(id,label,bytes) VALUES(?,?,?)').bind(1,'one',new Uint8Array([0,255,42])).run();
  assert.equal(run.success,true); assert.equal(run.meta.changes,1);
  assert.equal(await db.prepare('SELECT label FROM bridge_values WHERE id=?').bind(1).first('label'),'one');
  assert.deepEqual(await db.prepare('SELECT label FROM bridge_values WHERE id=2').first(),null);
  assert.deepEqual((await db.prepare('SELECT label FROM bridge_values').all()).results,[{label:'one'}]);
  assert.deepEqual(await db.prepare('SELECT id,label FROM bridge_values').raw(),[[1,'one']]);
  assert.deepEqual(await db.prepare('SELECT id,label FROM bridge_values').raw({columnNames:true}),[['id','label'],[1,'one']]);
  assert.deepEqual(await db.prepare('SELECT bytes FROM bridge_values').first('bytes'),[0,255,42]);
});

test('D1 batch is atomic and preserves positional result metadata', async () => {
  const result = await db.batch([db.prepare('INSERT INTO bridge_values(id,label) VALUES(?,?)').bind(2,'two'),db.prepare('SELECT label FROM bridge_values WHERE id=2')]);
  assert.equal(result.length,2); assert.equal(result[0].meta.changes,1); assert.deepEqual(result[1].results,[{label:'two'}]);
  await assert.rejects(db.batch([db.prepare("INSERT INTO bridge_values(id,label) VALUES(3,'three')"),db.prepare("INSERT INTO bridge_values(id,label) VALUES(2,'duplicate')")]));
  assert.equal(await db.prepare('SELECT id FROM bridge_values WHERE id=3').first(),null);
});

test('client rejects response overflow, redirects, transport failures and makes no write retry', async () => {
  let count=0;
  const failed = new HttpD1Database(endpoint,secret,async()=>{count++;throw new TypeError('private data');});
  await assert.rejects(failed.prepare("INSERT INTO bridge_values(id) VALUES(4)").run(),/D1_BRIDGE_UNAVAILABLE/);
  assert.equal(count,1);
  const overflow = new HttpD1Database(endpoint,secret,async()=>new Response(' '.repeat(2097153)));
  await assert.rejects(overflow.prepare('SELECT 1').all(),/D1_BRIDGE_LIMIT_EXCEEDED/);
  const redirect = new HttpD1Database(endpoint,secret,async(_url,init)=>{assert.equal(init.redirect,'error');return new Response('',{status:302,headers:{Location:'https://example.com'}});});
  await assert.rejects(redirect.prepare('SELECT 1').first(),/D1_BRIDGE_UNAVAILABLE/);
});

test('origin fails closed while status/ping remain usable with missing Discord credentials', async () => {
  assert.equal((await handleRequest(new Request('https://preview-host.vercel.app/me'),values,ctx,transport)).status,503);
  assert.equal((await request('/authorize',{}, {...values,AUTH_ORIGIN:'https://evil.example'})).status,503);
  const missing = {...values,DISCORD_CLIENT_SECRET:undefined};
  const status = await request('/canary/status',{},missing); assert.equal(status.status,200);
  assert.deepEqual(await status.json(),{ok:true,platform:'vercel',canary:true,configured:{origin:true,bridge:true,discord:false},health:'canary_reachable'});
  const ping = await request('/diagnostics/ping',{headers:{'CF-Ray':'fake','CF-Connecting-IP':'1.2.3.4'}},missing);
  assert.equal(ping.status,200); assert.equal(ping.headers.get('Timing-Allow-Origin'),'*'); assert.equal((await ping.json()).network.cf_ray,null);
  assert.equal((await request('/authorize',{},missing)).status,503);
  assert.equal((await request('/diagnostics?client_id=nakwol-vercel-comparison',{},missing)).status,200);
  assert.equal((await request('/sdk/v0.3.2/nakwol-auth-web.js',{},missing)).status,200);
});

test('diagnostic tickets/application/report use real test DB without Discord credentials', async () => {
  const missing = {...values,DISCORD_CLIENT_SECRET:undefined};
  const headers={Origin:origin,'Content-Type':'application/json'};
  assert.equal((await request('/diagnostics/application?client_id=nakwol-vercel-comparison',{headers},missing)).status,200);
  const issued=await request('/diagnostics/tickets?client_id=nakwol-vercel-comparison',{method:'POST',headers,body:'{}'},missing);
  assert.equal(issued.status,201);const ticket=await issued.json();
  const response=await request('/diagnostics/reports/'+ticket.reference+'?client_id=nakwol-vercel-comparison',{method:'POST',headers:{...headers,'X-Nakwol-Diagnostic-Capability':ticket.capability},body:JSON.stringify({schema_version:1,observations:[],browser:'chromium',platform:'desktop'})},missing);
  assert.equal(response.status,201);assert.equal((await response.json()).reference,ticket.reference);
});

test('SDK immutable version routes are byte-identical to shared source', async () => {
  for (const version of ['0.1.0','0.2.0','0.3.0','0.3.1','0.3.2']) {
    const response = await request('/sdk/v'+version+'/nakwol-auth-web.js');
    assert.equal(response.status,200);
    const filename=version==='0.1.0'?'nakwol-auth-web.js.txt':'nakwol-auth-web-v'+version+'.js.txt';
    assert.equal(await response.text(),await readFile('src/assets/'+filename,'utf8'));
    assert.match(response.headers.get('Cache-Control'),/immutable/);
  }
});
test('Node shared AUTH executes no-bot Discord OAuth, PKCE token and member /me via actual HTTP D1', async () => {
  const originalFetch=globalThis.fetch;
  const discordId='123456789012345678';
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url==='https://discord.com/api/oauth2/token') { const form=new URLSearchParams(init.body);assert.equal(form.get('redirect_uri'),origin+'/auth/discord/callback');return Response.json({access_token:'discord-user-token'}); }
    if(url==='https://discord.com/api/v10/users/@me')return Response.json({id:discordId,username:'test-member',avatar:null});
    if(url.endsWith('/member'))return Response.json({roles:[values.NAKWOL_MEMBER_ROLE_ID]});
    if(url.startsWith('https://discord.com/')) throw new Error('Unexpected Discord route: '+url);
    assert.ok(!url.includes('nakwol-auth.sepsd21.workers.dev'));
    return originalFetch(input,init);
  };
  try {
    assert.equal(values.DISCORD_BOT_TOKEN,undefined);
    const verifier='verifier-01234567890123456789012345678901234567890123456789';
    const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
    const client='nakwol-vercel-comparison', redirect=origin+'/diagnostics';
    const authorize=await request('/authorize?'+new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'site-state'}));
    assert.equal(authorize.status,302);const discord=new URL(authorize.headers.get('Location'));assert.equal(discord.origin,'https://discord.com');assert.equal(discord.searchParams.get('redirect_uri'),origin+'/auth/discord/callback');
    const callback=await request('/auth/discord/callback?'+new URLSearchParams({state:discord.searchParams.get('state'),code:'discord-code'}));
    assert.equal(callback.status,302);const final=new URL(callback.headers.get('Location'));assert.equal(final.origin,origin);assert.ok(final.searchParams.get('code'));assert.equal(final.searchParams.get('state'),'site-state');
    assert.match(callback.headers.get('Set-Cookie'),/HttpOnly/);assert.match(callback.headers.get('Set-Cookie'),/Secure/);
    const payload={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code:final.searchParams.get('code'),code_verifier:verifier};
    const tokenResponse=await request('/token?client_id='+client,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(tokenResponse.status,200);const token=await tokenResponse.json();assert.ok(token.access_token);
    const me=await request('/me?client_id='+client,{headers:{Origin:origin,Authorization:'Bearer '+token.access_token}});
    assert.equal(me.status,200);const identity=await me.json();assert.equal(identity.data.membership.role,'member');
    assert.equal((await request('/token?client_id='+client,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,400);
    assert.equal((await request('/me?client_id='+client,{headers:{Origin:origin}})).status,401);
    assert.equal((await request('/me?client_id='+client,{headers:{Origin:'https://evil.example',Authorization:'Bearer '+token.access_token}})).status,403);
    await db.prepare('UPDATE memberships SET role_ids=? WHERE user_id=?').bind('[]',identity.data.id).run();
    assert.equal((await request('/me?client_id='+client,{headers:{Origin:origin,Authorization:'Bearer '+token.access_token}})).status,403);
    await db.prepare('INSERT INTO application_access_grants(client_id,discord_user_id,status,reason,updated_by,updated_at) VALUES(?,?,?,?,?,?)').bind(client,discordId,'active','test fixture only',identity.data.id,Date.now()).run();
    const granted=await request('/me?client_id='+client,{headers:{Origin:origin,Authorization:'Bearer '+token.access_token}});assert.equal(granted.status,200);assert.equal((await granted.json()).application_access.source,'manual_grant');
    assert.equal((await request('/admin/api/apps',{headers:{Authorization:'Bearer '+token.access_token}})).status,401);
  } finally {globalThis.fetch=originalFetch;}
});

test('failed actual bridge request returns sanitized 503 and not successful AUTH', async()=>{
  const failed=async()=>new Response('{"ok":false}',{status:503});
  const response=await handleRequest(new Request(origin+'/me?client_id=nakwol-vercel-comparison',{headers:{Origin:origin}}),values,ctx,failed);
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:{code:'TEST_DATABASE_UNAVAILABLE'}});
});
test('Node wrapper preserves streamed/parsed JSON and parsed form bodies through real HTTP', async()=>{
  const originalFetch=globalThis.fetch;
  const previous={};for(const [key,value] of Object.entries(values)){previous[key]=process.env[key];process.env[key]=value;}
  globalThis.fetch=(input,init)=>String(input)===endpoint?originalFetch(new URL('/rpc',localUrl),init):originalFetch(input,init);
  const server=createServer(async(incoming,outgoing)=>{
    if(incoming.headers['x-test-consumed']==='true'){
      let text='';for await(const chunk of incoming)text+=chunk;
      incoming.body=incoming.headers['content-type'].includes('json')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text));
    }
    await handler(incoming,outgoing);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();const base='http://127.0.0.1:'+address.port;
  const localCall = (url, options = {}) => new Promise((resolve,reject) => {
    const req = nodeRequest(url, {method:options.method || 'GET',headers:options.headers}, res => {
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(options.method==='HEAD'?null:Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(options.body);
  });
  try{
    const payload={grant_type:'authorization_code',code:'no-code',client_id:'different-app',redirect_uri:origin+'/diagnostics',code_verifier:'bad-verifier'};
    for(const [contentType,consumed,body] of [['application/json',false,JSON.stringify(payload)],['application/json',true,JSON.stringify(payload)],['application/x-www-form-urlencoded',true,new URLSearchParams(payload).toString()]]){
      const response=await localCall(base+'/token?client_id=nakwol-vercel-comparison',{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,'Content-Type':contentType,'X-Test-Consumed':String(consumed)},body});
      assert.equal(response.status,400,await response.clone().text());assert.equal((await response.json()).error.code,'CLIENT_ID_MISMATCH');
    }
    const head=await localCall(base+'/sdk/manifest.json',{method:'HEAD',headers:{Host:new URL(origin).host}});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    const spoof=await localCall(base+'/canary/status',{headers:{Host:'unregistered.vercel.app','X-Forwarded-Host':new URL(origin).host}});
    assert.equal(spoof.status,503);
    for(const path of ['/runtime/auth-runtime.mjs','/bridge-worker.mjs','/bootstrap.sql.template','/api/auth-runtime']){
      const response=await localCall(base+path,{headers:{Host:new URL(origin).host}});assert.equal(response.status,404);assert.ok(!(await response.text()).includes('import '));
    }
  }finally{
    globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});

test('bootstrap activates only test-origin apps and leaves no identities, operators or grants', async()=>{
  const apps=await db.prepare("SELECT redirect_uris FROM applications WHERE status='active'").all();
  for(const row of apps.results)for(const uri of JSON.parse(row.redirect_uris))assert.equal(new URL(uri).origin,origin);
  const extra=await db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status='active' AND client_id IN ('nakwol-auth-lab','nakwol-my-data','nakwol-data-lab')").first('n');assert.equal(extra,0);
});
test('client deadline aborts once at ten seconds without retry', async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let attempts=0;
  const database=new HttpD1Database(endpoint,secret,async(_url,init)=>{
    attempts++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  });
  const operation=database.prepare('SELECT 1').first();
  t.mock.timers.tick(10000);
  await assert.rejects(operation,/D1_BRIDGE_UNAVAILABLE/);assert.equal(attempts,1);
  t.mock.timers.reset();
});

test('bridge missing canary flag or weak secret fails closed before DB execution', async()=>{
  const {default:bridge}=await import('../../deploy/vercel-auth-test/bridge-worker.mjs');
  const native=await mf.getD1Database('DB');
  for(const env of [{DB:native,D1_BRIDGE_SECRET:secret,NAKWOL_D1_TEST_BRIDGE:'false'},{DB:native,D1_BRIDGE_SECRET:'short',NAKWOL_D1_TEST_BRIDGE:'true'}]){
    const response=await bridge.fetch(new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({method:'exec',query:'DROP TABLE users'})}),env);
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false});
  }
  assert.ok((await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'))>0);
});
test('bridge caps actual D1 responses without returning result data', async()=>{
  const response=await fetch(new URL('/rpc',localUrl),{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({method:'all',statement:{query:"WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<30) SELECT hex(zeroblob(50000)) AS oversized FROM n",params:[]}})});
  assert.equal(response.status,413);assert.deepEqual(await response.json(),{ok:false});
});
