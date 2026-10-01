import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { verifyProtection } from '../src/protection-verify.mjs';
import { sha256, safeAssetPath, protectionBuildHash, readProtectionManifest } from '../src/protection-inventory.mjs';
import { installProtection } from '../src/protection.mjs';
import { writeProjectConfig } from '../src/config.mjs';

const privateBody = 'PRIVATE-CANARY-123456';
const headers = {'X-Nakwol-Gate':'v1','X-Nakwol-Runtime':'0.7.1','Cache-Control':'private, no-store'};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'nakwol-evidence-')); t.after(() => rm(root,{recursive:true,force:true}));
  const manifest = join(root,'manifest.json');
  const files=[{path:'/data.json',size:Buffer.byteLength(privateBody),sha256:sha256(privateBody),canary:privateBody}];
  await writeFile(manifest,JSON.stringify({schemaVersion:1,deploymentId:'deploy-1',buildHash:protectionBuildHash(files),runtimeVersion:'0.7.1',capabilities:['all-paths'],files}));
  return {provider:'custom',url:'https://site.test/',manifest};
}

test('authenticated canonical redirects verify final bytes without forwarding cookies to foreign origins', async t => {
  const options = await fixture(t);
  process.env.NAKWOL_REDIRECT_PROBE='session=redirect-test';
  t.after(()=>delete process.env.NAKWOL_REDIRECT_PROBE);
  for (const mode of ['canonical','foreign','loop','wrong-bytes']) {
    const seen=[];
    const result=await verifyProtection({...options,sessionCookieEnv:'NAKWOL_REDIRECT_PROBE',fetchImpl:async(url,init)=>{
      if (init.headers?.Cookie !== 'session=redirect-test') return new Response(null,{status:401,headers});
      seen.push(url.origin);
      if (url.pathname==='/canonical' && mode!=='loop') return new Response(mode==='wrong-bytes'?'wrong':privateBody);
      return new Response(null,{status:307,headers:{Location:mode==='foreign'?'https://foreign.test/canonical':'/canonical'}});
    }});
    assert.equal(result.releaseAccepted,mode==='canonical',mode);
    assert.ok(seen.every(origin=>origin==='https://site.test'));
    assert.ok(seen.length<=6,'redirect loops are bounded');
  }
});
test('manifest proves authenticated existence; anonymous-only or always401 is not release accepted',async t => {
  const options = await fixture(t);
  const denied = () => new Response('denied',{status:401,headers});
  const anonymous = await verifyProtection({...options,fetchImpl:denied});
  assert.equal(anonymous.ok,true); assert.equal(anonymous.releaseAccepted,false);
  process.env.NAKWOL_EVIDENCE_TEST_COOKIE='session=test-only'; t.after(()=>delete process.env.NAKWOL_EVIDENCE_TEST_COOKIE);
  const broken = await verifyProtection({...options,sessionCookieEnv:'NAKWOL_EVIDENCE_TEST_COOKIE',fetchImpl:denied});
  assert.equal(broken.releaseAccepted,false);
  const result = await verifyProtection({...options,sessionCookieEnv:'NAKWOL_EVIDENCE_TEST_COOKIE',fetchImpl:async(url,init)=>init.headers?.Cookie==='session=test-only'?new Response(privateBody):denied()});
  assert.equal(result.releaseAccepted,true); assert.equal(result.evidenceBinding.deploymentId,'deploy-1');
  assert.equal(JSON.stringify(result).includes('session=test-only'),false);
  await assert.rejects(verifyProtection({...options,deploymentId:'other'}),/binding mismatch/);
});
test('401 private content, cached304 and same-origin redirect to200 are exposure; 404/503 are unknown',async t => {
  const options = await fixture(t);
  for (const status of [401,304,404,503,302]) {
    const result = await verifyProtection({...options,fetchImpl:async(url)=>url.pathname==='/public'?new Response(privateBody):new Response(status===401?privateBody:null,{status,headers:{...headers,...(status===302?{Location:'/public'}:{})}})});
    assert.equal(result.ok,false);
    assert.equal(result.originResults[0].status,[401,304,302].includes(status)?'exposed':'unknown');
  }
});
test('large bodies are partial, origins are explicitly enumerated and authenticated cookie never leaves primary',async t => {
  const options = await fixture(t);
  const large = await verifyProtection({...options,fetchImpl:async()=>new Response('x'.repeat(1024*1024+1),{status:401,headers})});
  assert.equal(large.ok,false); assert.equal(large.checks.some(c=>!c.bodyComplete),true);
  const originsFile=join(tmpdir(),`nakwol-origins-${Date.now()}.json`);t.after(()=>rm(originsFile,{force:true}));
  await writeFile(originsFile,JSON.stringify({schemaVersion:1,origins:['https://other.test/']}));
  process.env.NAKWOL_EVIDENCE_SCOPE_COOKIE='session=scoped';t.after(()=>delete process.env.NAKWOL_EVIDENCE_SCOPE_COOKIE);
  const seen=[];
  const result=await verifyProtection({...options,originsFile,sessionCookieEnv:'NAKWOL_EVIDENCE_SCOPE_COOKIE',fetchImpl:async(url,init)=>{if(init.headers?.Cookie==='session=scoped'){seen.push(url.origin);return new Response(privateBody);}return new Response(null,{status:401,headers});}});
  assert.deepEqual(seen,['https://site.test']);assert.equal(result.origins.length,2);
});
test('unsafe encoded traversal and backslashes are rejected',()=>{
  for(const path of ['//evil/x','/%2e%2e/x','/%5cevil','/x?y','/x\n']) assert.equal(safeAssetPath(path),false,path);
});
test('real HTTP fixture verifies GET HEAD Range cache probes and authenticated file bytes',async t=>{
  const options=await fixture(t), requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,range:req.headers.range,url:req.url});
    if(req.headers.cookie==='session=http-test') {res.writeHead(200,{'Content-Type':'application/json'});res.end(privateBody);return;}
    res.writeHead(401,headers);res.end('denied');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  process.env.NAKWOL_HTTP_EVIDENCE_COOKIE='session=http-test';t.after(()=>delete process.env.NAKWOL_HTTP_EVIDENCE_COOKIE);
  const result=await verifyProtection({...options,sessionCookieEnv:'NAKWOL_HTTP_EVIDENCE_COOKIE',fetchImpl:(url,init)=>fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`,init)});
  assert.equal(result.releaseAccepted,true);
  assert.equal(requests.some(r=>r.method==='HEAD'),true);
  assert.equal(requests.some(r=>r.range==='bytes=0-63'),true);
  assert.equal(requests.some(r=>r.url==='/data.json'),true);
});
test('manifest mutation during probe invalidates completed evidence',async t=>{
  const options=await fixture(t);let first=true;
  const result=await verifyProtection({...options,fetchImpl:async()=>{
    if(first){first=false;const files=[{path:'/data.json',size:privateBody.length,sha256:sha256(privateBody)}];await writeFile(options.manifest,JSON.stringify({schemaVersion:1,deploymentId:'deploy-2',buildHash:protectionBuildHash(files),runtimeVersion:'0.7.1',capabilities:[],files}));}
    return new Response(null,{status:401,headers});
  }});
  assert.equal(result.manifestUnchanged,false);assert.equal(result.ok,false);assert.equal(result.releaseAccepted,false);
});
test('canonical build hash is order independent and rejects invented hash',async t=>{
  const options=await fixture(t),manifest=await readProtectionManifest(options.manifest);
  const files=[...manifest.files,{path:'/other.json',size:1,sha256:sha256('x')}];
  assert.equal(protectionBuildHash(files),protectionBuildHash([...files].reverse()));
  await writeFile(options.manifest,JSON.stringify({...manifest,buildHash:'a'.repeat(64)}));
  await assert.rejects(verifyProtection(options),/canonical/);
});
test('HTML aliases detect body hashes without canaries and cache probes retain normal cache mode',async t=>{
  const options=await fixture(t),manifest=await readProtectionManifest(options.manifest);
  const files=[{path:'/index.html',size:privateBody.length,sha256:sha256(privateBody)},{path:'/guide.html',size:privateBody.length,sha256:sha256(privateBody)}];
  await writeFile(options.manifest,JSON.stringify({...manifest,files,buildHash:protectionBuildHash(files)}));
  const seen=[];
  const result=await verifyProtection({...options,fetchImpl:async(url,init)=>{seen.push({url,init});return new Response(init.method==='HEAD'?null:privateBody,{status:401,headers});}});
  assert.equal(result.checks.find(c=>c.name==='https://site.test/ GET').classification,'exposed');
  assert.equal(result.checks.find(c=>c.name==='https://site.test/guide GET').classification,'exposed');
  assert.equal(seen.filter(r=>!r.url.search).every(r=>r.init.cache==='default'),true);
  const redirect=await verifyProtection({...options,fetchImpl:async url=>new Response(null,{status:url.pathname==='/public'?200:302,headers:{...headers,Location:'/public'}})});
  assert.equal(redirect.requestCount,redirect.probeCount*2);
});
test('installed manifest checks actual local bytes before issuing remote probes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'nakwol-local-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));
  await writeFile(join(root,'index.html'),'<html><body>PRIVATE</body></html>');
  await writeFile(join(root,'dist/index.html'),privateBody);
  await writeProjectConfig(root,{clientId:'test-site',framework:'html',redirectUris:['https://site.test/'],integration:'universal-embed',authMode:'required'});
  const installed=await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
  const files=[{path:'/index.html',size:privateBody.length,sha256:sha256(privateBody)}];
  const manifest=join(root,'manifest.json');
  await writeFile(manifest,JSON.stringify({schemaVersion:1,deploymentId:'deploy-1',buildHash:protectionBuildHash(files),runtimeVersion:installed.runtimeVersion||'0.7.1',capabilities:[],files}));
  await writeFile(join(root,'dist/index.html'),'changed bytes');
  await assert.rejects(verifyProtection({root,manifest,fetchImpl:async()=>{throw new Error('Must not fetch');}}),/local file size\/hash mismatch/);
});
