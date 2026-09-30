import test from 'node:test';
import assert from 'node:assert/strict';
import { serveProtected } from '../src/server/gate.mjs';
import { verifyControl } from '../src/server/control.mjs';
import { readFile } from 'node:fs/promises';
import { verifyProtection } from '../src/protection-verify.mjs';

test('bounded control must fail closed instead of silently using the legacy gate', async () => {
  const result = await serveProtected(new Request('https://site.test/image.webp'), {
    NAKWOL_SESSION_SECRET:'01234567890123456789012345678901',
    NAKWOL_CONTROL_PROFILE:'bounded-control',
    ASSETS:{fetch:async()=>new Response('private')},
  }, {clientId:'a',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
  assert.equal(result.status,503);
});

test('signed control expiry, binding, replay, outages and 300-asset hot path',async t=>{
  const originalFetch=globalThis.fetch;let now=1900000000000;
  t.mock.method(Date,'now',()=>now);t.after(()=>globalThis.fetch=originalFetch);
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKeys={fixture:await crypto.subtle.exportKey('jwk',pair.publicKey)};
  const settings={clientId:'control-a',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
  let epoch=7,controlCalls=0,refreshCalls=0,assetCalls=0,deny=false,outage=false,replay;
  const env={NAKWOL_SESSION_SECRET:'control-cookie-key-01234567890123456789',NAKWOL_SITE_CREDENTIAL:'control-credential',NAKWOL_CONTROL_PROFILE:'bounded-control',NAKWOL_CONTROL_PUBLIC_KEYS:JSON.stringify(publicKeys),ASSETS:{fetch:async request=>{assetCalls++;const status=request.headers.has('If-None-Match')?304:request.headers.has('Range')?206:200;return new Response(request.method==='HEAD'||status===304?null:'private',{status,headers:{ETag:'"fixture"'}});}}};
  const doc=overrides=>({schemaVersion:1,audience:'nakwol-control-v1',clientId:settings.clientId,siteOrigin:'https://site.test',version:epoch,appEpoch:epoch,appStatus:'active',policyFloor:1,revocations:[],issuedAt:now,expiresAt:now+30000,...overrides});
  const envelope=async body=>{const payload=Buffer.from(JSON.stringify(body)).toString('base64url');return {kid:'fixture',payload,signature:Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode('fixture.'+payload))).toString('base64url')};};
  const proof=()=>({sessionId:'control-session',userId:'user',clientId:settings.clientId,siteOrigin:'https://site.test',source:'role',generation:refreshCalls,verifiedAt:now,leaseUntil:now+300000,authorizationEvidenceValidUntil:now+900000,sessionExpiresAt:now+3600000,absoluteExpiresAt:1900086400000,policyVersion:1,controlVersion:epoch});
  globalThis.fetch=async(input,init)=>{
    const path=new URL(input).pathname;
    assert.equal(init.headers.Authorization,'Bearer control-credential');
    if(path.endsWith('/control')){controlCalls++;await new Promise(resolve=>setTimeout(resolve,20));if(outage)return new Response(null,{status:503});return Response.json(replay??await envelope(doc()));}
    if(path.endsWith('/refresh')){refreshCalls++;await new Promise(resolve=>setTimeout(resolve,20));return deny?new Response(null,{status:403}):Response.json({ok:true,session:proof()});}
    return Response.json({ok:true,session:proof(),handle:'h'.repeat(43)});
  };
  const request=(path='/',cookie='',extra={})=>new Request('https://site.test'+path,{...extra,headers:{Cookie:cookie,...extra.headers}});
  const jar=response=>response.headers.getSetCookie().filter(c=>!c.split(';')[0].endsWith('=')).map(c=>c.split(';')[0]).join('; ');
  const start=await serveProtected(request('/__nakwol/start'),env,settings);
  const state=new URL(start.headers.get('Location')).searchParams.get('state');
  const login=await serveProtected(request('/__nakwol/callback?state='+state+'&code=fixture',jar(start)),env,settings);
  assert.equal(login.status,303);const cookie=jar(login);
  const measures=[];
  async function load(label,fn=serveProtected,options=env){const initial=controlCalls,before=refreshCalls,begin=performance.now();const html=await fn(request('/',cookie),options,settings);const htmlMs=performance.now()-begin;const imagesAt=performance.now();const images=await Promise.all(Array.from({length:300},(_,i)=>fn(request('/'+i+'.webp',cookie),options,settings)));assert.equal(html.status,200);assert.ok(images.every(r=>r.status===200));measures.push({label,htmlMs:Number(htmlMs.toFixed(2)),images300Ms:Number((performance.now()-imagesAt).toFixed(2)),controlCalls:controlCalls-initial,refreshCalls:refreshCalls-before});}
  await load('local-lease',serveProtected,{...env,NAKWOL_CONTROL_PROFILE:'local-lease'});await load('cold');await load('warm');now+=31000;await load('snapshot-expired');
  assert.equal(measures[0].controlCalls,0);assert.equal(measures[1].controlCalls,1);assert.equal(measures[2].controlCalls,0);assert.equal(measures[3].controlCalls,1);assert.ok(measures.every(m=>m.refreshCalls===0));
  assert.equal((await serveProtected(request('/image',cookie,{method:'HEAD'}),env,settings)).status,200);
  assert.equal((await serveProtected(request('/image',cookie,{headers:{Range:'bytes=0-1'}}),env,settings)).status,206);
  const conditional=await serveProtected(request('/image',cookie,{headers:{'If-None-Match':'"fixture"'}}),env,settings);assert.equal(conditional.status,304);assert.match(conditional.headers.get('Cache-Control'),/^private, no-cache/);
  const before=controlCalls;for(const extra of [{},{method:'HEAD'},{headers:{Range:'bytes=0-1'}}])for(const path of ['/','/image.webp','/data.json','/font.woff2','/app.js','/style.css','/download.bin'])assert.equal((await serveProtected(request(path,'',extra),env,settings)).status,401);
  assert.equal(controlCalls,before);
  const verified=await verifyProtection({provider:'custom',url:'https://site.test/',paths:'/image.webp,/data.json,/font.woff2,/app.js,/style.css,/download.bin',expectRuntime:'0.12.0',fetchImpl:(url,init)=>serveProtected(new Request(url,init),env,settings)});
  assert.equal(verified.ok,true,JSON.stringify(verified.checks.filter(c=>!c.ok)));
  assert.equal(verified.requestCount,28);assert.equal(controlCalls,before);
  assert.equal((await serveProtected(request('/image',cookie.replace('v3.','v9.')),env,settings)).status,401);
  const signed=await envelope(doc());
  for(const invalid of [{kid:'unknown'},{signature:signed.signature.slice(1)}])await assert.rejects(verifyControl({...signed,...invalid},publicKeys,settings));
  for(const invalid of [{issuedAt:now+5001,expiresAt:now+35001},{expiresAt:now},{expiresAt:now+30001},{siteOrigin:'https://other.test'},{clientId:'other'},{audience:'other'},{revocations:Array(301).fill('id')}])await assert.rejects(verifyControl(await envelope(doc(invalid)),publicKeys,settings,now));
  epoch=8;now+=31000;const renewalAt=refreshCalls;
  const concurrent=await Promise.all(Array.from({length:300},()=>serveProtected(request('/image.webp',cookie),env,settings)));
  assert.ok(concurrent.every(r=>r.status===200));assert.equal(refreshCalls-renewalAt,1);
  deny=true;epoch=9;now+=31000;
  const controlURL=new URL('../src/server/control.mjs?isolate=second',import.meta.url).href;
  const code=(await readFile(new URL('../src/server/session.mjs',import.meta.url),'utf8')).replace("'./control.mjs'",JSON.stringify(controlURL)).replace("'./observations.mjs'",JSON.stringify(new URL('../src/server/observations.mjs?isolate=second',import.meta.url).href));
  const {serveServerSession:second}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const callsAt=refreshCalls;const denied=await Promise.all(Array.from({length:300},()=>second(request('/image.webp',cookie),env,settings)));
  assert.ok(denied.every(r=>r.status===403));assert.equal(refreshCalls-callsAt,1);
  outage=true;now+=31000;const assetsAt=assetCalls;const stopped=await Promise.all(Array.from({length:300},()=>serveProtected(request('/image.webp',cookie),env,settings)));assert.ok(stopped.every(r=>r.status===503));assert.equal(assetCalls,assetsAt);
  outage=false;now+=1100;replay=signed;assert.equal((await serveProtected(request('/image',cookie),env,settings)).status,503);
  now+=1100;replay=await envelope(doc({version:1,appEpoch:1}));assert.equal((await serveProtected(request('/image',cookie),env,settings)).status,503);
  now+=1100;replay=await envelope(doc({revocations:['control-session']}));const refreshBefore=refreshCalls;
  assert.equal((await serveProtected(request('/image',cookie),env,settings)).status,403);assert.equal(refreshCalls,refreshBefore);
  console.log(JSON.stringify({benchmark:measures,upstreamDelayMs:20,assetsProtected:300,revocationObservedWithinMs:31000}));
});
