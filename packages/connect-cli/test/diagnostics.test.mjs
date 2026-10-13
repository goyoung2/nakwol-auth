import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { diagnosticRuntime, diagnosticScript, diagnosticsPage } from '../src/server/diagnostics.mjs';
import { serveProtected } from '../src/server/gate.mjs';

function fixture(fetchImpl) {
  const nodes=new Map();
  for(const id of ['start','cancel','copy','download','login','status','results','reference','upload'])nodes.set('diagnostics-'+id,{textContent:'',disabled:false,replaceChildren(){},append(){},onclick:null});
  const values=new Map();
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const context=vm.createContext({window:{fetch:fetchImpl,navigator:{userAgent:'Firefox fixture'}},navigator:{userAgent:'Firefox fixture'},document:{getElementById:id=>nodes.get(id),createElement:()=>({textContent:''})},sessionStorage:storage,crypto:webcrypto,location:{origin:'https://site.test'},URL,Blob,Response,DOMException,Headers,AbortController,TextEncoder,performance,setTimeout,clearTimeout,console});
  const runtime=vm.runInContext(diagnosticScript({clientId:'site',authOrigin:'https://auth.test',sitePing:true,redirectUri:'https://site.test/'}),context);
  return {runtime,nodes,context,values};
}
test('self-contained runtime survives offline AUTH, exports only sanitized observations and makes bounded probes',async()=>{
  const calls=[];const f=fixture(async(url)=>{calls.push(url);throw new TypeError('private bearer raw URL');});
  await f.runtime.run();
  assert.equal(calls.length,5);
  assert.ok(calls.every(url=>url.startsWith('https://auth.test/diagnostics/')||url==='https://auth.test/sdk/v0.3.1/nakwol-auth-web.js'||url==='https://site.test/__nakwol/diagnostics/ping'));
  const report=f.runtime.localReport();
  assert.equal(report.upload_confirmed,false);assert.equal(report.server_reference,null);assert.equal(report.observations.length,4);
  assert.ok(report.observations.every(o=>o.outcome==='timeout_or_cors'&&o.http_status===null));
  assert.equal(JSON.stringify(report).includes('private'),false);assert.equal(JSON.stringify(report).includes('https://'),false);
  assert.equal(f.nodes.get('diagnostics-start').disabled,false);assert.equal(f.nodes.get('diagnostics-cancel').disabled,true);
});
test('cancel aborts the active probe, preserves completed local evidence and never issues a ticket',async()=>{
  let calls=0;
  const f=fixture(async(_url,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Abort','AbortError'))));});
  const pending=f.runtime.run();f.runtime.cancel();await pending;
  assert.equal(calls,1);assert.equal(f.runtime.localReport().observations[0].outcome,'cancelled');
  assert.equal(f.runtime.localReport().upload_confirmed,false);
});
test('report acknowledgement alone controls server reference; credential never appears in export',async()=>{
  const reference='dg_'+'a'.repeat(24),capability='b'.repeat(43);let uploads=0;
  const f=fixture(async(url)=>{
    if(url.includes('/tickets'))return Response.json({reference,capability,expires_at:Date.now()+60000},{status:201});
    if(url.includes('/reports/')){uploads++;return uploads===1?Response.json({ok:true,reference},{status:201}):Response.json({ok:false},{status:503});}
    return Response.json({ok:true});
  });
  await f.runtime.run();assert.equal(f.runtime.localReport().server_reference,reference);
  assert.equal(f.runtime.localReport().upload_confirmed,true);assert.equal(JSON.stringify(f.runtime.localReport()).includes(capability),false);
  const confirmed=vm.runInContext(diagnosticScript({clientId:'site',authOrigin:'https://auth.test',sitePing:true,redirectUri:'https://site.test/'}),f.context);assert.equal(confirmed.localReport().upload_confirmed,true);assert.match(f.nodes.get('diagnostics-upload').textContent,/이전 보고서/);
  await f.runtime.fetchImpl('https://auth.test/me?client_id=site');assert.equal(f.runtime.localReport().upload_confirmed,false);assert.equal(f.runtime.localReport().server_reference,null);assert.equal(f.runtime.localReport().issued_reference,reference);
  await f.runtime.upload();assert.match(f.nodes.get('diagnostics-upload').textContent,/이번 전송/);assert.equal(f.runtime.localReport().upload_confirmed,false);
  const restored=vm.runInContext(diagnosticScript({clientId:'site',authOrigin:'https://auth.test',sitePing:true,redirectUri:'https://site.test/'}),f.context);assert.equal(restored.localReport().upload_confirmed,false);assert.equal(restored.localReport().server_reference,null);
});
test('official diagnostic exceptions are origin-bound and never forward to ASSETS',async()=>{
  const settings={clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
  let assetCalls=0,authCalls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{authCalls++;throw new Error('unexpected');};
  try {
    const env={NAKWOL_SESSION_SECRET:'a'.repeat(32),ASSETS:{fetch(){assetCalls++;return new Response('SECRET');}}};
    for(const path of ['/__nakwol/diagnostics','/__nakwol/diagnostics/ping']) {
      const response=await serveProtected(new Request('https://site.test'+path),env,settings);assert.equal(response.status,200);assert.equal((await response.text()).includes('SECRET'),false);
      assert.equal((await serveProtected(new Request('https://site.test'+path,{method:'HEAD'}),env,settings)).status,200);
      assert.equal((await serveProtected(new Request('https://site.test'+path,{headers:{Range:'bytes=0-10'}}),env,settings)).status,416);
      assert.equal((await serveProtected(new Request('https://other.test'+path),env,settings)).status,403);
      assert.equal((await serveProtected(new Request('https://site.test'+path,{headers:{Origin:'https://evil.test'}}),env,settings)).status,403);
    }
    for(const path of ['/private.html','/private.js','/private.css','/private.json','/image.png','/font.woff2','/download.zip','/__nakwol/diagnostics/secret'])for(const init of [{},{method:'HEAD'},{headers:{Range:'bytes=0-10'}}]){
      assert.equal((await serveProtected(new Request('https://site.test'+path,init),env,settings)).status,401);
    }
    assert.equal(assetCalls,0);assert.equal(authCalls,0);
  }finally{globalThis.fetch=original;}
});
test('central page hides site login and escapes script settings without external runtime dependency',()=>{
  const page=diagnosticsPage({clientId:'site',clientName:'</script><script>private()</script>',authOrigin:'https://auth.test',central:true});
  assert.match(page,/<button id="diagnostics-login"[^>]*hidden/);
  assert.equal(page.includes('</script><script>private()'),false);
  assert.equal(page.includes('src='),false);
  assert.ok(diagnosticRuntime.toString().includes('fetchImpl'));
});

test('ping timing uses only owned ResourceTiming and marks reused or unavailable setup metrics null',async()=>{
  const f=fixture(async()=>Response.json({ok:true}));
  f.context.performance={now:()=>100,getEntriesByName:()=>[{startTime:100,domainLookupStart:0,domainLookupEnd:0,connectStart:10,secureConnectionStart:15,connectEnd:25,requestStart:30,responseStart:42}],getEntriesByType:()=>[]};
  await f.runtime.run();const result=f.runtime.localReport();
  for(const o of result.observations.filter(o=>['site_ping','auth_ping'].includes(o.probe)))assert.deepEqual(JSON.parse(JSON.stringify(o.timing)),{dns_ms:null,connect_ms:5,tls_ms:10,ttfb_ms:12});
  assert.equal(JSON.stringify(result).includes('requestStart'),false);
});

test('Worker esbuild output remains a self-contained browser runtime and does not fold server user-agent',async()=>{
  const {build}=await import('esbuild');
  const output=await build({entryPoints:[fileURLToPath(new URL('../src/server/diagnostics.mjs',import.meta.url))],bundle:true,write:false,platform:'browser',format:'esm',keepNames:true,define:{'navigator.userAgent':'"Cloudflare-Workers"'}});
  const bundled=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
  const f=fixture(async()=>Response.json({ok:true}));
  const source=bundled.diagnosticScript({clientId:'site',authOrigin:'https://auth.test',sitePing:true});
  assert.equal(source.includes('Cloudflare-Workers'),false);
  const runtime=vm.runInContext(source,f.context);await runtime.run();assert.equal(runtime.localReport().browser,'firefox');assert.equal(runtime.localReport().platform,'desktop');
});

test('cancel remains active while ticket response JSON is pending',async()=>{
  let jsonStarted;const pendingBody=new Promise(resolve=>{jsonStarted=resolve;});
  const f=fixture(async(url,options)=>{
    if(!url.includes('/tickets'))return Response.json({ok:true});
    return {ok:true,json:()=>{jsonStarted();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Abort','AbortError'))));}};
  });
  const running=f.runtime.run();await pendingBody;f.runtime.cancel();await running;
  assert.equal(f.nodes.get('diagnostics-start').disabled,false);assert.equal(f.runtime.localReport().upload_confirmed,false);
});

test('storage denial preserves offline diagnostic run and sanitized export',async()=>{
 const f=fixture(async()=>{throw new Error('offline private');});
 f.context.sessionStorage={getItem(){throw new Error('Storage denied');},setItem(){throw new Error('Storage denied');},removeItem(){throw new Error('Storage denied');}};
 const runtime=vm.runInContext(diagnosticScript({clientId:'site',authOrigin:'https://auth.test',sitePing:true}),f.context);
 await runtime.run();assert.equal(runtime.localReport().observations.length,4);assert.equal(runtime.localReport().upload_confirmed,false);assert.equal(JSON.stringify(runtime.localReport()).includes('private'),false);
});
test('diagnosed response completion bounds stalled bodies, preserves caller cancellation and caps bytes',async()=>{
 const reference='dg_'+'a'.repeat(24),capability='b'.repeat(43);let mode='ok';
 const f=fixture(async(url)=>{
  if(url.includes('/tickets'))return Response.json({reference,capability,expires_at:Date.now()+60000});
  if(url.includes('/reports/'))return Response.json({ok:true,reference});
  if(url.includes('/me'))return mode==='large'?new Response(new Uint8Array(65537)):mode==='stall'?new Response(new ReadableStream({start(){}})):Response.json({ok:true});
  return Response.json({ok:true});
 });
 await f.runtime.run();mode='stall';f.context.setTimeout=(fn,ms)=>setTimeout(fn,Math.min(ms,5));
 await assert.rejects(f.runtime.fetchImpl('https://auth.test/me?client_id=site'),/aborted/);
 assert.equal(f.runtime.localReport().observations.at(-1).outcome,'timeout_or_cors');
 const caller=new AbortController();const pending=f.runtime.fetchImpl('https://auth.test/me?client_id=site',{signal:caller.signal});caller.abort();await assert.rejects(pending,/aborted/);
 assert.equal(f.runtime.localReport().observations.at(-1).outcome,'cancelled');
 mode='large';await assert.rejects(f.runtime.fetchImpl('https://auth.test/me?client_id=site'),/TOO_LARGE/);
 mode='ok';const complete=await f.runtime.fetchImpl('https://auth.test/me?client_id=site');assert.deepEqual(await complete.json(),{ok:true});
});
