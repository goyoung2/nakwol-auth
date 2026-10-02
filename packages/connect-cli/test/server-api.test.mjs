import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../src/server/gate.mjs';
import { createServer } from 'node:http';
import { once } from 'node:events';

const settings = {clientId:'api-site',siteUrl:'https://api.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
const sessionSecret = 'a'.repeat(40);
async function apiModule() {
  const module = await import('nakwol-connect/server');
  assert.equal(typeof module.protectHandler, 'function', 'official server export must provide protectHandler');
  assert.equal(typeof module.authorizeRequest, 'function', 'official server export must provide authorizeRequest');
  return module;
}
async function fixture(t) {
  const original = globalThis.fetch;
  const clock = Date.now;
  let now = clock(), calls = 0, outage = false;
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/me'); calls++;
    if (outage) return new Response(null,{status:503});
    const id = options.headers.Authorization.slice(7);
    return Response.json({ok:true,data:{id,status:'active',membership:{is_member:true}},application_access:{client_id:'api-site',allowed:true,source:'policy'},expires_at:now+3600000});
  };
  t.after(()=>{globalThis.fetch=original;Date.now=clock;});
  const gate=createGate(settings), cookies={};
  for(const id of ['owner-a','owner-b']) {
    const response=await gate(new Request('https://api.test/__nakwol/session',{method:'POST',headers:{Origin:'https://api.test','Content-Type':'application/json'},body:JSON.stringify({access_token:id})}),{sessionSecret,serveAsset:()=>{throw new Error('asset called');}});
    assert.equal(response.status,204); cookies[id]=response.headers.get('Set-Cookie').split(';')[0];
  }
  return {cookies,get calls(){return calls;},expire(){now+=300001;},fail(){outage=true;}};
}
test('official API authorizer blocks anonymous requests before invoking handlers',async()=>{
  const {protectHandler,authorizeRequest}=await apiModule();let called=0;
  const handler=protectHandler(()=>{called++;return Response.json({private:true});},settings);
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE']) {
    const response=await handler(new Request('https://api.test/api/decks',{method,headers:{Origin:'https://api.test'}}),{sessionSecret});
    assert.equal(response.status,401); assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
  assert.equal(called,0);
  const result=await authorizeRequest(new Request('https://api.test/api/decks'),{settings,sessionSecret});
  assert.equal(result.allowed,false);assert.equal(result.response.status,401);
});
test('member mutations use trusted principal, untouched body and service row ownership',async t=>{
  const {protectHandler,authorizeRequest}=await apiModule();const f=await fixture(t);let called=0;
  const handler=protectHandler(async(request,principal)=>{
    called++;assert.equal(request.headers.get('X-User-ID'),null);assert.equal(request.headers.get('X-Roles'),null);assert.equal(request.headers.get('X-Nakwol-User'),null);
    assert.equal(principal.clientId,'api-site');assert.deepEqual(principal.scopes,[]);
    assert.equal('token' in principal,false);assert.equal('handle' in principal,false);
    return Response.json({owner:principal.userId,body:await request.text()},{headers:{'Cache-Control':'public,max-age=999',ETag:'"private"'}});
  },{...settings,authorizeResource:(_request,principal)=>principal.userId==='owner-a'});
  for(const method of ['POST','PUT','PATCH','DELETE']) {
    const response=await handler(new Request('https://api.test/api/decks/owned-by-a',{method,headers:{Cookie:f.cookies['owner-a'],Origin:'https://api.test','X-User-ID':'owner-b','X-Roles':'admin','X-Nakwol-User':'spoof'},body:'private body'}),{sessionSecret});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{owner:'owner-a',body:'private body'});assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
  const denied=await handler(new Request('https://api.test/api/decks/owned-by-a',{method:'DELETE',headers:{Cookie:f.cookies['owner-b'],Origin:'https://api.test'}}),{sessionSecret});assert.equal(denied.status,403);assert.equal(called,4);
  const result=await authorizeRequest(new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}}),{settings,sessionSecret});assert.equal(result.allowed,true);assert.equal(result.principal.userId,'owner-a');assert.ok(result.responseHeaders instanceof Headers);
  assert.equal(f.calls,2,'valid lease causes no central round trips');
});
test('CSRF, reserved routes, websocket and SSE cannot reach the API handler',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);let called=0;
  const handler=protectHandler(()=>{called++;return Response.json({ok:true});},settings);
  for(const headers of [{},{Origin:'https://other.test'},{Origin:'https://api.test','Sec-Fetch-Site':'cross-site'}]) {
    const response=await handler(new Request('https://api.test/api/decks',{method:'POST',headers:{Cookie:f.cookies['owner-a'],...headers},body:'not consumed'}),{sessionSecret});assert.equal(response.status,403);
  }
  for(const headers of [{Upgrade:'websocket'},{Accept:'text/event-stream'},{Connection:'upgrade'}]) assert.equal((await handler(new Request('https://api.test/api/events',{headers:{Cookie:f.cookies['owner-a'],...headers}}),{sessionSecret})).status,501);
  assert.equal((await handler(new Request('https://api.test/__nakwol/status',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret})).status,404);assert.equal(called,0);
});
test('API expiry, tampering and wrong app/origin remain fail closed',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);let called=0;
  const handler=protectHandler(()=>{called++;return Response.json({ok:true});},settings);
  assert.equal((await handler(new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']+'corrupt'}}),{sessionSecret})).status,401);
  assert.equal((await handler(new Request('https://wrong.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret})).status,403);
  const other=protectHandler(()=>{called++;return Response.json({ok:true});},{...settings,clientId:'other'});assert.equal((await other(new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret})).status,401);
  f.expire();f.fail();assert.equal((await handler(new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret})).status,503);assert.equal(called,0);
});

test('concurrent expired API requests share revalidation and retain HEAD/Range protection',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);let called=0;
  const handler=protectHandler(request=>{called++;return new Response(request.method==='HEAD'?null:'bytes',{status:request.headers.has('Range')?206:200});},settings);
  f.expire();const responses=await Promise.all(Array.from({length:300},()=>handler(new Request('https://api.test/api/download',{headers:{Cookie:f.cookies['owner-a'],Range:'bytes=0-4'}}),{sessionSecret})));
  assert.ok(responses.every(r=>r.status===206));assert.equal(called,300);assert.equal(f.calls,3);assert.ok(responses.every(r=>r.headers.get('Set-Cookie')));
  assert.equal((await handler(new Request('https://api.test/api/download',{method:'HEAD',headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret})).status,200);
  assert.equal((await handler(new Request('https://api.test/api/download',{method:'HEAD',headers:{Range:'bytes=0-4'}}),{sessionSecret})).status,401);
});
test('streaming responses are rejected even without a streaming request header',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);let canceled=false;
  const handler=protectHandler(()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}}),settings);
  const response=await handler(new Request('https://api.test/api/events',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret});assert.equal(response.status,501);assert.equal(canceled,true);
});
test('lease renewal preserves service cookies as well as the protected session cookie',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);
  const handler=protectHandler(()=>new Response('ok',{headers:{'Set-Cookie':'service-preference=compact; Path=/; Secure'}}),settings);f.expire();
  const response=await handler(new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret});
  assert.ok(response.headers.getSetCookie().some(c=>c.startsWith('service-preference=')));assert.ok(response.headers.getSetCookie().some(c=>c.startsWith('__Host-nakwol_connect=')));
});
test('SSE media type whitespace cannot bypass long-connection rejection',async t=>{
  const {protectHandler}=await apiModule();const f=await fixture(t);
  for(const type of ['text/event-stream ; charset=utf-8','text/event-stream\t; charset=utf-8',' TEXT/EVENT-STREAM ; charset=utf-8']) {
    let canceled=false;const handler=protectHandler(()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':type}}),settings);
    const response=await handler(new Request('https://api.test/api/events',{headers:{Cookie:f.cookies['owner-a']}}),{sessionSecret});assert.equal(response.status,501);assert.equal(canceled,true);
  }
});
test('API vendor cache headers cannot override the no-store contract',async t=>{
  const {protectHandler,authorizeRequest}=await apiModule();const f=await fixture(t);
  const names=['CDN-Cache-Control','Cloudflare-CDN-Cache-Control','Surrogate-Control'];
  const handler=protectHandler(()=>Response.json({personal:true},{headers:Object.fromEntries(names.map(n=>[n,'public, max-age=86400']))}),settings);
  const request=new Request('https://api.test/api/decks',{headers:{Cookie:f.cookies['owner-a']}});
  const response=await handler(request,{sessionSecret});for(const name of names)assert.match(response.headers.get(name),/no-store/);
  const checked=await authorizeRequest(request,{settings,sessionSecret});assert.equal(checked.allowed,true);for(const name of names)assert.match(checked.responseHeaders.get(name),/no-store/);
});

test('real HTTP server sessions enforce two-user ownership, renew cookies and fail closed',async t=>{
  const {protectHandler,authorizeRequest}=await apiModule();
  const originalFetch=globalThis.fetch, clock=Date.now;let now=clock(),centralCalls=0,outage=false,handlerCalls=0;
  async function nativeFetch(input,options) {
    try {return await originalFetch(input,options);}
    catch(error) {
      const cause=error instanceof Error ? error.cause : undefined;
      t.diagnostic(JSON.stringify({transport:'local-http',host:new URL(input).host,message:error instanceof Error?error.message:String(error),cause:cause instanceof Error?cause.message:String(cause)}));
      throw error;
    }
  }
  Date.now=()=>now;t.after(()=>{Date.now=clock;globalThis.fetch=originalFetch;});
  const sessions=new Map();
  const proof=(id,userId,generation=0)=>({sessionId:id,generation,userId,clientId:'api-site',siteOrigin:'https://api.test',source:'role',verifiedAt:now,leaseUntil:now+60000,authorizationEvidenceValidUntil:now+3600000,sessionExpiresAt:now+3600000,absoluteExpiresAt:now+86400000,policyVersion:7});
  const central=createServer(async(req,res)=>{
    centralCalls++;const chunks=[];for await(const chunk of req)chunks.push(chunk);
    assert.equal(req.headers.authorization,'Bearer fixture-site-credential');
    if(outage){res.writeHead(503);res.end();return;}
    const body=JSON.parse(Buffer.concat(chunks).toString());let result;
    if(req.url==='/server/v1/code-exchange'){
      const id='session-'+body.code;const session=proof(id,body.code);sessions.set(id,session);result={ok:true,session,handle:'h'.repeat(43)+id};
    } else if(req.url==='/server/v1/session/refresh') {
      const prior=sessions.get(body.session_id);assert.ok(prior);const session={...proof(prior.sessionId,prior.userId,prior.generation+1),absoluteExpiresAt:prior.absoluteExpiresAt};sessions.set(prior.sessionId,session);result={ok:true,session};
    } else {res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  });central.listen(0,'127.0.0.1');await once(central,'listening');
  t.after(()=>new Promise(resolve=>{central.close(resolve);central.closeAllConnections();}));
  const centralOrigin='http://127.0.0.1:'+central.address().port;
  globalThis.fetch=(url,options)=>nativeFetch(new URL(new URL(url).pathname,centralOrigin),options);
  const host={sessionSecret,siteCredential:'fixture-site-credential'};
  const gate=createGate(settings);
  const handler=protectHandler(async(req,principal)=>{handlerCalls++;return Response.json({owner:principal.userId,body:await req.text()},{headers:{ETag:'"personal"','Cache-Control':'public,max-age=999'}});},{...settings,authorizeResource:(_req,p)=>p.userId==='owner-a'});
  const site=createServer(async(req,res)=>{
    try {
      const request=new Request('https://api.test'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
      const response=req.url.startsWith('/__nakwol/')?await gate(request,{...host,serveAsset:()=>Response.json({static:true})}):await handler(request,host);
      const headers=Object.fromEntries([...response.headers].filter(([name])=>name!=='set-cookie'));
      res.writeHead(response.status,{...headers,...(response.headers.getSetCookie().length?{'Set-Cookie':response.headers.getSetCookie()}:{})});res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end(String(error));}
  });site.listen(0,'127.0.0.1');await once(site,'listening');
  t.after(()=>new Promise(resolve=>{site.close(resolve);site.closeAllConnections();}));
  const local='http://127.0.0.1:'+site.address().port;
  const login=async user=>{
    const start=await nativeFetch(local+'/__nakwol/start',{redirect:'manual'});const state=new URL(start.headers.get('Location')).searchParams.get('state');
    const response=await nativeFetch(local+'/__nakwol/callback?state='+state+'&code='+user,{redirect:'manual',headers:{Cookie:start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}});assert.equal(response.status,303);
    return response.headers.getSetCookie().filter(c=>!c.includes('Max-Age=0')).map(c=>c.split(';')[0]).join('; ');
  };
  const a=await login('owner-a'),b=await login('owner-b');assert.equal(centralCalls,2);
  for(const method of ['GET','HEAD','POST','PUT','DELETE']) {
    const response=await nativeFetch(local+'/api/deck',{method,headers:{Cookie:a,Origin:'https://api.test'},...(!['GET','HEAD'].includes(method)?{body:'payload'}:{})});assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);await response.arrayBuffer();
  }
  const before=handlerCalls;
  assert.equal((await nativeFetch(local+'/api/deck',{method:'DELETE',headers:{Cookie:b,Origin:'https://api.test'}})).status,403);
  assert.equal((await nativeFetch(local+'/api/deck',{method:'POST',headers:{Cookie:a,Origin:'https://evil.test'},body:'x'})).status,403);
  assert.equal((await nativeFetch(local+'/api/deck')).status,401);assert.equal(handlerCalls,before);assert.equal(centralCalls,2);
  const auth=await authorizeRequest(new Request('https://api.test/api/deck',{headers:{Cookie:a}}),{settings,...host});assert.equal(auth.principal.policyVersion,7);
  now+=61000;
  const renewed=await nativeFetch(local+'/api/deck',{headers:{Cookie:a}});assert.equal(renewed.status,200);assert.ok(renewed.headers.getSetCookie().some(c=>c.startsWith('__Host-nakwol_proof=')));await renewed.arrayBuffer();assert.equal(centralCalls,3);
  now+=61000;outage=true;const count=handlerCalls;
  assert.equal((await nativeFetch(local+'/api/deck',{method:'PUT',headers:{Cookie:a,Origin:'https://api.test'},body:'not applied'})).status,503);assert.equal(handlerCalls,count);
});
