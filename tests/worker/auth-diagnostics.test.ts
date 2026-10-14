import { migrationStatements } from './migration-statements';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import { Hono } from 'hono';
import auth from '../../src/index';
import { registerDiagnosticRoutes, cleanupDiagnostics } from '../../src/diagnostics';
import { sha256Base64Url } from '../../src/crypto';

test('real D1 diagnostic capability, bounded ingestion, origin, operator, OAuth and retention contracts', async t => {
  const options={modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']};
  const mf=new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare?miniflare.convertV4MiniflareOptions(options):options);
  t.after(()=>mf.dispose());
  const DB=await mf.getD1Database('DB');
  const directory=new URL('../../migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(f=>f.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(file,directory),'utf8');
    for(const statement of migrationStatements(sql)) await DB.prepare(statement).run();
  }
  const env={DB,NAKWOL_GUILD_ID:'1493410906456064112',NAKWOL_MEMBER_ROLE_ID:'1553600098661957643',AUTH_ORIGIN:'https://auth.test',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture'};
  const app=new Hono();registerDiagnosticRoutes(app);registerDiagnosticRoutes(auth);
  for(const [id,origin] of [['site','https://site.test'],['other','https://other.test']]) await DB.prepare("INSERT INTO applications VALUES(?,? ,?,'active',0,0)").bind(id,id,JSON.stringify([origin+'/'])).run();
  for(const id of ['operator','ordinary']) {
    await DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();
    await DB.prepare("INSERT INTO access_tokens VALUES(?,?,'nakwol-connect-admin',?,NULL,?)").bind(await sha256Base64Url(id),id,Date.now()+600000,Date.now()).run();
  }
  await DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('operator',0)").run();
  const request=(path:string,method='GET',origin='https://site.test',body?:unknown,capability?:string)=>app.request('https://auth.test'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(capability?{'X-Nakwol-Diagnostic-Capability':capability}:{})},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})},env);
  const issue=async(client='site',origin='https://site.test')=>{
    const response=await request('/diagnostics/tickets?client_id='+client,'POST',origin,{});
    assert.equal(response.status,201);const body:{reference:string;capability:string;expires_at:number}=await response.json();return body;
  };
  const valid={schema_version:1,observations:[{probe:'auth_ping',outcome:'ok',duration_ms:5,http_status:200}],browser:'chromium',platform:'desktop'};
  const preflight=await auth.request('https://auth.test/diagnostics/tickets?client_id=site',{method:'OPTIONS',headers:{Origin:'https://site.test','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-nakwol-diagnostic-capability'}},env);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://site.test');assert.match(preflight.headers.get('Access-Control-Allow-Headers')||'',/X-Nakwol-Diagnostic-Capability/);
  let ticket=await issue();
  const upload=(body:unknown=valid,client='site',origin='https://site.test',cap=ticket.capability)=>request('/diagnostics/reports/'+ticket.reference+'?client_id='+client,'POST',origin,body,cap);
  await t.test('tickets are exact-origin and app-bound, hashed, short-lived, report-only',async()=>{
    assert.notEqual((await DB.prepare('SELECT capability_hash FROM diagnostic_reports WHERE reference=?').bind(ticket.reference).first())?.capability_hash,ticket.capability);
    assert.equal((await request('/diagnostics/tickets?client_id=site','POST','https://evil.test',{})).status,403);
    assert.equal((await request('/diagnostics/tickets?client_id=missing','POST','https://auth.test',{})).status,403);
    assert.equal((await request('/diagnostics/tickets?client_id=site','POST','https://site.test.evil.test',{})).status,403);
    assert.equal((await upload(valid,'other','https://other.test')).status,401);
    assert.equal((await upload(valid,'site','https://evil.test')).status,403);
    assert.equal((await upload(valid,'site','https://site.test','x'.repeat(43))).status,401);
    const central=await issue('site','https://auth.test');
    assert.equal((await DB.prepare('SELECT client_id,origin FROM diagnostic_reports WHERE reference=?').bind(central.reference).first())?.client_id,'site');
    assert.equal((await request('/diagnostics/application?client_id=site')).status,200);
    assert.equal((await app.request('https://auth.test/diagnostics/application?client_id=site',{headers:{'Sec-Fetch-Site':'same-origin'}},env)).status,200);
    assert.equal((await app.request('https://evil.test/diagnostics/application?client_id=site',{headers:{'Sec-Fetch-Site':'same-origin'}},env)).status,403);
    assert.equal((await auth.request('https://auth.test/me?client_id=site',{headers:{Authorization:'Bearer '+ticket.capability}},env)).status,401);
    await DB.prepare('UPDATE diagnostic_reports SET expires_at=0 WHERE reference=?').bind(ticket.reference).run();
    assert.equal((await upload()).status,401);ticket=await issue();
  });
  await t.test('streamed cap, strict allowlists and bounded updates',async()=>{
    assert.equal((await upload({...valid,observations:[{...valid.observations[0],timing:{dns_ms:null,connect_ms:4,tls_ms:7,ttfb_ms:2}}]})).status,201);
    assert.equal((await upload({...valid,observations:[{...valid.observations[0],timing:{dns_ms:0,connect_ms:4,tls_ms:7,ttfb_ms:2,ip:'private'}}]})).status,400);
    assert.equal((await upload({...valid,error:'private',url:'https://secret.test/?code=oauth'})).status,400);
    assert.equal((await upload({...valid,observations:[{...valid.observations[0],token:'private'}]})).status,400);
    assert.equal((await upload({...valid,observations:[{probe:'arbitrary',outcome:'ok',duration_ms:1,http_status:200}]})).status,400);
    assert.equal((await upload({...valid,observations:Array(17).fill(valid.observations[0])})).status,400);
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(12289)));controller.close();}});
    const response=await app.request(new Request('https://auth.test/diagnostics/reports/'+ticket.reference+'?client_id=site',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json','X-Nakwol-Diagnostic-Capability':ticket.capability},body:stream,duplex:'half'}),undefined,env);
    assert.equal(response.status,413);
    for(let i=0;i<3;i++)assert.equal((await upload()).status,201);
    assert.equal((await upload()).status,401);
    const serialized=JSON.stringify(await DB.prepare('SELECT browser_json,network_json FROM diagnostic_reports WHERE reference=?').bind(ticket.reference).first());
    assert.equal(serialized.includes(ticket.capability),false);assert.equal(serialized.includes('private'),false);
  });
  await t.test('ordinary accounts and arbitrary app requests cannot read operator evidence',async()=>{
    const path='https://auth.test/admin/api/apps/site/auth-diagnostics';
    assert.equal((await app.request(path,{},env)).status,401);
    assert.equal((await app.request(path,{headers:{Authorization:'Bearer ordinary'}},env)).status,403);
    assert.equal((await request('/diagnostics/reports/'+ticket.reference)).status,404);
    const response=await app.request(path,{headers:{Authorization:'Bearer operator'}},env);
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const body:{data:{reports:{reference:string}[]}}=await response.json();assert.ok(body.data.reports.some(r=>r.reference===ticket.reference));
    const other=await app.request('https://auth.test/admin/api/apps/other/auth-diagnostics?reference='+ticket.reference,{headers:{Authorization:'Bearer operator'}},env);
    assert.deepEqual((await other.json()).data.reports,[]);
    const text=await (await app.request(path,{headers:{Authorization:'Bearer operator'}},env)).text();assert.equal(text.includes(ticket.capability),false);assert.equal(text.includes('capability_hash'),false);
  });
  await t.test('persistent network and global rate guards bound tickets and address rows',async()=>{
    await DB.prepare('DELETE FROM diagnostic_rate_guards').run();
    for(let i=0;i<6;i++)await issue();
    assert.equal((await request('/diagnostics/tickets?client_id=site','POST','https://site.test',{})).status,429);
    const rows=await DB.prepare('SELECT guard_hash,count FROM diagnostic_rate_guards').all();assert.equal(rows.results.length,2);
    assert.ok(rows.results.every(r=>typeof r.guard_hash==='string'&&r.guard_hash!=='unavailable'));
    await DB.prepare('UPDATE diagnostic_rate_guards SET count=300').run();
    assert.equal((await request('/diagnostics/tickets?client_id=site','POST','https://site.test',{})).status,429);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM diagnostic_rate_guards').first())?.n,2);
    await DB.prepare('DELETE FROM diagnostic_rate_guards').run();
  });
  await t.test('normal PKCE OAuth is correlated without secrets; stage persistence failure preserves success',async t=>{
    t.mock.method(Math,'random',()=>1);
    t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
      const url=String(input);
      if(url.endsWith('/oauth2/token'))return Response.json({access_token:'discord-private'});
      if(url.endsWith('/users/@me'))return Response.json({id:'1553600098661957644',username:'Fixture'});
      return Response.json({roles:[env.NAKWOL_MEMBER_ROLE_ID]});
    });
    ticket=await issue();
    const verifier='fixture-verifier',challenge=await sha256Base64Url(verifier);
    const params=new URLSearchParams({client_id:'site',redirect_uri:'https://site.test/',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'private-state',diagnostic_ref:ticket.reference});
    const begin=await auth.request('https://auth.test/authorize?'+params,{},env);
    assert.equal(begin.status,302);
    const state=new URL(begin.headers.get('Location')||'').searchParams.get('state');
    const callback=await auth.request('https://auth.test/auth/discord/callback?state='+state+'&code=private-discord-code',{},env);
    assert.equal(callback.status,302);assert.match(callback.headers.get('Set-Cookie')||'',/nakwol_sid/);
    const code=new URL(callback.headers.get('Location')||'').searchParams.get('code');
    const headers={Origin:'https://site.test','Content-Type':'application/json','X-Nakwol-Diagnostic-Reference':ticket.reference,'X-Nakwol-Diagnostic-Capability':ticket.capability};
    const tokenResponse=await auth.request('https://auth.test/token?client_id=site',{method:'POST',headers,body:JSON.stringify({grant_type:'authorization_code',code,client_id:'site',redirect_uri:'https://site.test/',code_verifier:verifier})},env);
    assert.equal(tokenResponse.status,200);const token:{access_token:string}=await tokenResponse.json();
    assert.equal((await auth.request('https://auth.test/me?client_id=site',{headers:{...headers,Authorization:'Bearer '+token.access_token}},env)).status,200);
    const stages=await DB.prepare('SELECT stage,status,network_json FROM diagnostic_stages WHERE reference=? ORDER BY id').bind(ticket.reference).all();
    for(const stage of ['authorize','discord_code_exchange','discord_identity','discord_member','membership_db','policy','code_creation','session_creation','token','me']) assert.ok(stages.results.some(r=>r.stage===stage&&r.status==='ok'),stage);
    assert.equal(JSON.stringify(stages.results).includes('private'),false);
    for(let i=0;i<50;i++)await auth.request('https://auth.test/me?client_id=site',{headers:{...headers,Authorization:'Bearer '+token.access_token}},env);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM diagnostic_stages WHERE reference=?').bind(ticket.reference).first())?.n,48);
    await DB.prepare('DROP TABLE diagnostic_stages').run();
    assert.equal((await auth.request('https://auth.test/me?client_id=site',{headers:{...headers,Authorization:'Bearer '+token.access_token}},env)).status,200);
    await DB.prepare('CREATE TABLE diagnostic_stages(id INTEGER PRIMARY KEY,reference TEXT,stage TEXT,status TEXT,duration_ms INTEGER,recorded_at INTEGER,network_json TEXT)').run();
  });
  await t.test('seven-day retention clears reports and stages and expired guards',async()=>{
    await DB.prepare('UPDATE diagnostic_reports SET created_at=0').run();await DB.prepare('UPDATE diagnostic_rate_guards SET expires_at=0').run();
    await cleanupDiagnostics(env);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM diagnostic_reports').first())?.n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM diagnostic_stages').first())?.n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM diagnostic_rate_guards').first())?.n,0);
  });
});
