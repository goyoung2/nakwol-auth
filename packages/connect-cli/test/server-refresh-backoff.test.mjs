import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../src/server/gate.mjs';

let sequence=0;
const LEASE=300000;
function fixture(t,{bounded=false}={}){
  const settings={clientId:'backoff-'+(++sequence),siteUrl:'https://backoff.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
  const gate=createGate(settings),sessions=new Map(),failures=new Map(),calls=new Map();
  let now=1900000000000,nextSession=0,served=0,epoch=1,controlTTL=30000,pair;
  t.mock.method(Date,'now',()=>now);
  const host={sessionSecret:'backoff-cookie-secret-01234567890123456789',siteCredential:'backoff-credential',controlProfile:bounded?'bounded-control':'local-lease',serveAsset:async()=>{served++;return new Response('protected');}};
  const proof=id=>({sessionId:id,userId:'user',generation:calls.get(id)||0,clientId:settings.clientId,siteOrigin:'https://backoff.test',source:'role',policyVersion:1,controlVersion:epoch,verifiedAt:now,leaseUntil:now+LEASE,authorizationEvidenceValidUntil:now+900000,sessionExpiresAt:Math.min(now+3600000,sessions.get(id)),absoluteExpiresAt:sessions.get(id)});
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    const path=new URL(input).pathname,body=JSON.parse(init.body);
    if(path.endsWith('/control')){
      const document={schemaVersion:1,audience:'nakwol-control-v1',clientId:settings.clientId,siteOrigin:'https://backoff.test',version:epoch,appEpoch:epoch,appStatus:'active',policyFloor:1,revocations:[],issuedAt:now,expiresAt:now+controlTTL};
      const payload=Buffer.from(JSON.stringify(document)).toString('base64url');
      return Response.json({kid:'backoff',payload,signature:Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode('backoff.'+payload))).toString('base64url')});
    }
    if(path.endsWith('/code-exchange')){const id=settings.clientId+'-session-'+(++nextSession);sessions.set(id,now+86400000);return Response.json({ok:true,session:proof(id),handle:'h'.repeat(43)+id});}
    assert.ok(path.endsWith('/refresh'));
    const key=init.headers.Authorization+'|'+body.session_id;
    calls.set(key,(calls.get(key)||0)+1);calls.set(body.session_id,(calls.get(body.session_id)||0)+1);
    const status=failures.get(key)??200;
    if(status==='network')throw new Error('synthetic outage');
    return status===200?Response.json({ok:true,session:proof(body.session_id)}):new Response(null,{status});
  });
  const request=(path,cookie,options={})=>gate(new Request('https://backoff.test'+path,{headers:{Cookie:cookie}}),{...host,...options});
  const jar=response=>response.headers.getSetCookie().filter(value=>!value.split(';')[0].endsWith('=')).map(value=>value.split(';')[0]).join('; ');
  return {
    get calls(){return [...calls].filter(([key])=>key.includes('|')).reduce((sum,[,count])=>sum+count,0);},get served(){return served;},
    advance(ms){now+=ms;},fail(id,status,credential=host.siteCredential){failures.set('Bearer '+credential+'|'+id,status);},
    async control(version,ttl=30000){epoch=version;controlTTL=ttl;if(!pair){pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);host.controlPublicKeys=JSON.stringify({backoff:await crypto.subtle.exportKey('jwk',pair.publicKey)});}},
    request,async wave(cookie,options={}){return Promise.all(Array.from({length:300},(_,index)=>request('/images/'+index+'.webp',cookie,options)));},
    async login(){const start=await request('/__nakwol/start','');const state=new URL(start.headers.get('Location')).searchParams.get('state');const callback=await request('/__nakwol/callback?state='+state+'&code=synthetic',jar(start));assert.equal(callback.status,303);return {cookie:jar(callback),id:settings.clientId+'-session-'+nextSession};},
  };
}

for(const status of [401,403,503,'network'])test('local refresh '+status+' bounds completed 300-request waves and recovers after exactly one second',async t=>{
  const f=fixture(t),{cookie,id}=await f.login();f.advance(LEASE+1);f.fail(id,status);
  const expected=status==='network'?503:status;
  for(let wave=0;wave<3;wave++){
    const responses=await f.wave(cookie);assert.ok(responses.every(response=>response.status===expected));
    assert.ok(responses.every(response=>response.headers.getSetCookie().length===0));
  }
  assert.equal(f.calls,1,'completed denial/outage waves must reuse one failed central refresh');assert.equal(f.served,0);
  f.fail(id,200);f.advance(999);
  assert.equal((await f.request('/before.webp',cookie)).status,expected);assert.equal(f.calls,1);assert.equal(f.served,0);
  f.advance(1);const recovered=await f.wave(cookie);assert.ok(recovered.every(response=>response.status===200));assert.equal(f.calls,2);assert.equal(f.served,300);
  f.advance(LEASE-1);assert.equal((await f.request('/still-valid.webp',cookie)).status,200);assert.equal(f.calls,2);
  f.advance(1);assert.equal((await f.request('/fixed-expiry.webp',cookie)).status,200);assert.equal(f.calls,3,'completed success must expire at its original 300-second deadline');
});

test('refresh failure backoff is isolated by session and site credential',async t=>{
  const f=fixture(t),a=await f.login(),b=await f.login();f.advance(LEASE+1);f.fail(a.id,503);
  assert.equal((await f.request('/a.webp',a.cookie)).status,503);
  assert.equal((await f.request('/b.webp',b.cookie)).status,200);
  assert.equal((await f.request('/credential.webp',a.cookie,{siteCredential:'separate-credential'})).status,200);
  assert.equal((await f.request('/a-again.webp',a.cookie)).status,503);
  assert.equal(f.calls,3);assert.equal(f.served,2);
});

test('bounded refresh outages back off for one second while remaining fail closed',async t=>{
  const f=fixture(t,{bounded:true});await f.control(1);const {cookie,id}=await f.login();f.advance(LEASE+1);f.fail(id,503);
  for(let wave=0;wave<3;wave++)assert.ok((await f.wave(cookie)).every(response=>response.status===503));
  assert.equal(f.calls,1);assert.equal(f.served,0);f.fail(id,200);f.advance(999);
  assert.equal((await f.request('/before.webp',cookie)).status,503);assert.equal(f.calls,1);assert.equal(f.served,0);
  f.advance(1);assert.equal((await f.request('/recovered.webp',cookie)).status,200);assert.equal(f.calls,2);assert.equal(f.served,1);
});

test('bounded refresh denial remains thirty seconds and a new control epoch invalidates it',async t=>{
  const f=fixture(t,{bounded:true});await f.control(1,500);const {cookie,id}=await f.login();f.advance(LEASE+1);f.fail(id,403);
  assert.ok((await f.wave(cookie)).every(response=>response.status===403));assert.equal(f.calls,1);assert.equal(f.served,0);
  f.fail(id,200);f.advance(29999);assert.equal((await f.request('/denied.webp',cookie)).status,403);assert.equal(f.calls,1);
  f.advance(1);assert.equal((await f.request('/recovered.webp',cookie)).status,200);assert.equal(f.calls,2);
  await f.control(2,500);f.advance(LEASE+1);f.fail(id,403);assert.equal((await f.request('/epoch-two.webp',cookie)).status,403);assert.equal(f.calls,3);
  await f.control(3,500);f.fail(id,200);f.advance(501);assert.equal((await f.request('/epoch-three.webp',cookie)).status,200);assert.equal(f.calls,4);
});
