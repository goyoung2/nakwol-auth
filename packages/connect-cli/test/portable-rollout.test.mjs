import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {writeProjectConfig} from '../src/config.mjs';
import {sha256,protectionBuildHash} from '../src/protection-inventory.mjs';
import {installProtection,updateProtection,createProtectionManifest} from '../src/protection.mjs';
import {verifyProtection} from '../src/protection-verify.mjs';
import {RUNTIME_VERSION} from '../src/server/gate.mjs';
import {runRollout,validateAutomaticConfig} from '../src/portable-rollout.mjs';

const body='PRIVATE-ROLLOUT-FIXTURE';
const cookieEnv='NAKWOL_PORTABLE_TEST_COOKIE';
async function fixture(t,provider='vercel') {
  const root=await mkdtemp(join(tmpdir(),'nakwol-rollout-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));
  await writeFile(join(root,'dist/index.html'),body);
  await writeFile(join(root,'index.html'),'<body></body>');
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'echo build'}}));
  await writeProjectConfig(root,{clientId:'site',authMode:'required',accessPolicy:'member',redirectUris:['https://site.test/']});
  await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
  const stateFile=join(root,'adapter-state.json');
  await writeFile(stateFile,JSON.stringify({deploymentId:'old',writes:0,mode:'good',operationId:null}));
  const adapterFile='deploy-adapter.mjs';
  const adapterSource=`import {readFile,writeFile,rm,mkdir,rename} from 'node:fs/promises';
let input=''; for await (const part of process.stdin) input+=part;
const request=JSON.parse(input), file=${JSON.stringify(stateFile)};
const state=JSON.parse(await readFile(file,'utf8'));
const binding={schemaVersion:1,provider:${JSON.stringify(provider)},resourceId:'test-project',origins:['https://site.test/',...(state.extraOrigin?['https://new-preview.test/']:[])],inventoryComplete:true};
let result;
if(request.action==='capabilities') result={...binding,serializedDeployments:true,compareBeforeWrite:true,rollback:true};
else if(request.action==='current') result={...binding,deploymentId:state.deploymentId,operationId:state.operationId};
else {
  if(state.deploymentId!==request.expectedDeploymentId) throw new Error('changed');
  state.writes++;
  state.deploymentId=request.action==='deploy'?'new':'recovery';
  state.operationId=request.operationId;
  if(state.addOrigin && request.action==='deploy'){state.extraOrigin=true;binding.origins.push('https://new-preview.test/');}
  if(state.dropOrigin && request.action==='rollback'){state.extraOrigin=false;binding.origins=['https://site.test/'];}
  if(state.mode==='rollback-fails' && request.action==='rollback') throw new Error('secret-must-not-be-logged');
  await writeFile(file+'.adapter.tmp',JSON.stringify(state));await rename(file+'.adapter.tmp',file);
  if(state.mode==='journal-fails' && request.action==='deploy') {await rm(${JSON.stringify(join(root,'rollout.json'))});await mkdir(${JSON.stringify(join(root,'rollout.json'))});}
  result={...binding,deploymentId:state.deploymentId,operationId:state.operationId};
}
process.stdout.write(JSON.stringify(result));`;
  await writeFile(join(root,adapterFile),adapterSource);
  const config=JSON.parse(await readFile(join(root,'.nakwol-connect.json'),'utf8'));
  const previousManifest=join(root,'previous-manifest.json');
  const candidateManifest=join(root,'candidate-manifest.json');
  await createProtectionManifest({root,deploymentId:'old',outputFile:previousManifest});
  await createProtectionManifest({root,deploymentId:'build-only',outputFile:candidateManifest});
  process.env[cookieEnv]='session=local-only';t.after(()=>delete process.env[cookieEnv]);
  const seen=[];
  const server=createServer(async(req,res)=>{
    seen.push({cookie:req.headers.cookie,method:req.method,range:req.headers.range});
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    const bad=state.deploymentId==='new';
    if(bad && state.mode==='leak') {res.writeHead(200);res.end(body);return;}
    if(bad && state.mode==='outage') {res.writeHead(503);res.end();return;}
    if(req.headers.cookie==='session=local-only' && !(bad && state.mode==='deny-all')) {res.writeHead(200);res.end(body);return;}
    res.writeHead(401,{'X-Nakwol-Gate':'v1','X-Nakwol-Runtime':RUNTIME_VERSION,'Cache-Control':'private, no-store'});res.end('denied');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const fetchImpl=(url,init)=>fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`,init);
  const previousReport=join(root,'previous-report.json');
  const report=await verifyProtection({root,manifest:previousManifest,sessionCookieEnv:cookieEnv,expectRuntime:RUNTIME_VERSION,deploymentId:'old',fetchImpl});
  await writeFile(previousReport,JSON.stringify(report));
  config.protection.automatic={enabled:true,provider,resourceId:'test-project',serializedDeployments:true,adapterFile,adapterSha256:sha256(adapterSource),credentialEnv:[],sessionCookieEnv:cookieEnv,previousManifest:'previous-manifest.json',previousReport:'previous-report.json'};
  await writeProjectConfig(root,config);
  const state=()=>readFile(stateFile,'utf8').then(JSON.parse);
  const change=async patch=>{await writeFile(stateFile+'.test.tmp',JSON.stringify({...await state(),...patch}));await rename(stateFile+'.test.tmp',stateFile);};
  return {root,config,state,change,seen,fetchImpl,candidateManifest,outputFile:join(root,'rollout.json')};
}

for(const provider of ['cloudflare-workers','cloudflare-pages','vercel','netlify','custom-host']) test(`${provider}: portable contract verifies baseline and deployed bytes without provider assumptions`,async t=>{
  const f=await fixture(t,provider);
  const result=await runRollout(f);
  assert.equal(result.ok,true);assert.equal(result.status,'release-verified');
  assert.equal((await f.state()).writes,1);
  assert.equal(result.releaseAccepted,true);assert.equal(result.deploymentId,'new');
  assert.equal(result.verification.authenticatedExistenceVerified,true);
  assert.equal(f.seen.some(x=>x.method==='HEAD'),true);
  assert.equal(f.seen.some(x=>x.range==='bytes=0-63'),true);
  assert.equal(JSON.stringify(result).includes('session=local-only'),false);
});
for(const mode of ['leak','outage','deny-all']) test(`${mode}: rejected release restores verified artifact and still fails the job`,async t=>{
  const f=await fixture(t);await f.change({mode});
  const result=await runRollout(f);
  assert.equal(result.ok,false);assert.equal(result.releaseAccepted,false);
  assert.equal(result.status,'recovery-verified');assert.equal(result.recoveryVerified,true);
  assert.equal((await f.state()).writes,2);
  assert.equal((await f.state()).deploymentId,'recovery');
  const saved=JSON.parse(await readFile(f.outputFile,'utf8'));
  assert.equal(saved.failedVerification.releaseAccepted,false);
});
test('baseline failure performs zero deployment writes',async t=>{
  const f=await fixture(t);
  f.fetchImpl=async()=>new Response(null,{status:503});
  const result=await runRollout(f);
  assert.equal(result.status,'baseline-rejected');assert.equal((await f.state()).writes,0);
});
test('a later release cannot silently drop an origin preserved in the sealed baseline proof',async t=>{
 const f=await fixture(t),path=join(f.root,'previous-report.json'),proof=JSON.parse(await readFile(path));proof.origins.push('https://previous-preview.test/');await writeFile(path,JSON.stringify(proof));
 await assert.rejects(runRollout(f),/baseline origin|closure/);assert.equal((await f.state()).writes,0);
});
test('new deployment origins are included in every direct-access probe before release acceptance',async t=>{
 const f=await fixture(t);await f.change({addOrigin:true});const original=f.fetchImpl,seen=[];
 f.fetchImpl=async(url,init)=>{seen.push({origin:url.origin,method:init.method,range:init.headers?.Range});return original(url,init);};
 const result=await runRollout(f);assert.equal(result.status,'release-verified');assert.ok(result.verification.origins.includes('https://new-preview.test/'));assert.ok(seen.some(v=>v.origin==='https://new-preview.test'&&v.method==='HEAD'));
});
test('rollback cannot hide a removed origin or accept an old failed deployment that still leaks',async t=>{
 for(const dropOrigin of [true,false]){const f=await fixture(t);await f.change({addOrigin:true,dropOrigin});const original=f.fetchImpl;
  f.fetchImpl=async(url,init)=>url.origin==='https://new-preview.test'?new Response(body,{status:200}):original(url,init);
  const result=await runRollout(f);assert.equal(result.releaseAccepted,false);assert.equal(result.recoveryVerified,false);assert.ok(['recovery-indeterminate','recovery-failed'].includes(result.status));assert.equal((await f.state()).writes,2);
 }
});
test('stale baseline ID refuses deployment before probing assets',async t=>{
  const f=await fixture(t);await f.change({deploymentId:'someone-else'});let probes=0;
  await assert.rejects(runRollout({...f,fetchImpl:async()=>{probes++;throw Error();}}),/baseline|deployment/i);
  assert.equal(probes,0);assert.equal((await f.state()).writes,0);
});
test('changed adapter, missing recovery proof and missing opt-in are rejected',async t=>{
  const f=await fixture(t);
  for(const patch of [{enabled:false},{serializedDeployments:false},{adapterSha256:'0'.repeat(64)},{resourceId:'wrong-project'}]) {
    const config=structuredClone(f.config);Object.assign(config.protection.automatic,patch);
    await writeProjectConfig(f.root,config);
    await assert.rejects(runRollout(f));
    assert.equal((await f.state()).writes,0);
  }
  await writeProjectConfig(f.root,f.config);
  const report=JSON.parse(await readFile(join(f.root,'previous-report.json'),'utf8'));report.releaseAccepted=false;
  await writeFile(join(f.root,'previous-report.json'),JSON.stringify(report));
  await assert.rejects(runRollout(f),/baseline|proof/i);assert.equal((await f.state()).writes,0);
});
test('unsupported capability never falls back to unchecked deploy',async t=>{
  const f=await fixture(t);
  const source=await readFile(join(f.root,'deploy-adapter.mjs'),'utf8');
  const changed=source.replace('compareBeforeWrite:true','compareBeforeWrite:false');
  await writeFile(join(f.root,'deploy-adapter.mjs'),changed);
  f.config.protection.automatic.adapterSha256=sha256(changed);await writeProjectConfig(f.root,f.config);
  await assert.rejects(runRollout(f),/capabilit|compare/i);assert.equal((await f.state()).writes,0);
});
test('candidate inventory drift is rejected before any provider mutation',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'dist/new.json'),'new');
  await assert.rejects(runRollout(f),/inventory|manifest/i);assert.equal((await f.state()).writes,0);
});
test('recovery error is persisted without adapter stderr or credentials',async t=>{
  const f=await fixture(t);await f.change({mode:'rollback-fails'});
  const old=f.fetchImpl;
  f.fetchImpl=async(url,init)=>(await f.state()).deploymentId==='new'?new Response(null,{status:503}):old(url,init);
  const result=await runRollout(f);
  assert.equal(result.status,'recovery-indeterminate');assert.equal(result.ok,false);
  assert.equal(JSON.stringify(result).includes('secret-must-not-be-logged'),false);
});
test('automatic configuration is tied to required member policy',async t=>{
  const f=await fixture(t);
  for(const authMode of ['optional']) await assert.rejects(validateAutomaticConfig(f.root,{...f.config,authMode}),/required|member/i);
  await assert.rejects(validateAutomaticConfig(f.root,{...f.config,accessPolicy:'guest'}),/required|member/i);
});
test('gate regeneration preserves the explicit hosting recovery connection',async t=>{
  const f=await fixture(t);
  await updateProtection({root:f.root});
  const config=JSON.parse(await readFile(join(f.root,'.nakwol-connect.json'),'utf8'));
  assert.deepEqual(config.protection.automatic,f.config.protection.automatic);
});
test('journal failure after provider mutation still attempts recovery and cannot succeed',async t=>{
  const f=await fixture(t);await f.change({mode:'journal-fails'});
  const result=await runRollout(f);
  assert.equal(result.ok,false);assert.equal(result.releaseAccepted,false);
  assert.equal(result.journalPersisted,false);
  assert.equal((await f.state()).deploymentId,'recovery');
  assert.equal((await f.state()).writes,2);
});
test('case aliases cannot pass GitHub token, session cookie or duplicate credentials to adapters',async t=>{
  const f=await fixture(t);
  for(const credentialEnv of [['github_token'],['Gh_ToKeN'],[cookieEnv.toLowerCase()],['CLOUDFLARE_API_TOKEN','cloudflare_api_token']]) {
    const config=structuredClone(f.config);config.protection.automatic.credentialEnv=credentialEnv;
    await assert.rejects(validateAutomaticConfig(f.root,config),/credential/i);
  }
});
test('files larger than the verifier bound refuse automatic deployment before mutation',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'dist/large.bin'),Buffer.alloc(1024*1024+1));
  await rm(f.candidateManifest);
  await createProtectionManifest({root:f.root,deploymentId:'build-only',outputFile:f.candidateManifest});
  await assert.rejects(runRollout(f),/size|bound|MiB/i);
  assert.equal((await f.state()).writes,0);
});
test('a concurrent deployment during verification is never overwritten by rollback',async t=>{
  const f=await fixture(t),original=f.fetchImpl;let switched=false;
  f.fetchImpl=async(url,init)=>{
    if(!switched && (await f.state()).deploymentId==='new') {
      switched=true;await f.change({deploymentId:'other-deployment',operationId:'other-operation'});
    }
    return original(url,init);
  };
  const result=await runRollout(f);
  assert.equal(result.status,'deployment-conflict');assert.equal(result.ok,false);
  assert.equal((await f.state()).writes,1);assert.equal((await f.state()).deploymentId,'other-deployment');
});
test('a report path outside the project is refused before deployment on native Windows paths',async t=>{
  const f=await fixture(t),outside=await mkdtemp(join(tmpdir(),'nakwol-outside-report-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await assert.rejects(runRollout({...f,outputFile:join(outside,'report.json')}),/project|stay/i);
  assert.equal((await f.state()).writes,0);
});
test('hosting child receives only its declared credentials, never GitHub, cookie or central secrets',async t=>{
  const f=await fixture(t);
  const names=['GITHUB_TOKEN','SESSION_SECRET','NAKWOL_TEST_HOST_TOKEN'];
  const saved=names.map(name=>process.env[name]);
  for(const name of names) process.env[name]='test-only-'+name;
  t.after(()=>names.forEach((name,i)=>{if(saved[i]===undefined) delete process.env[name];else process.env[name]=saved[i];}));
  const source=await readFile(join(f.root,'deploy-adapter.mjs'),'utf8');
  const guarded=`if(process.env.GITHUB_TOKEN || process.env.SESSION_SECRET || process.env.${cookieEnv} || process.env.NAKWOL_TEST_HOST_TOKEN!=='test-only-NAKWOL_TEST_HOST_TOKEN') throw Error('Credential isolation failed');\n`+source;
  await writeFile(join(f.root,'deploy-adapter.mjs'),guarded);
  f.config.protection.automatic.adapterSha256=sha256(guarded);
  f.config.protection.automatic.credentialEnv=['NAKWOL_TEST_HOST_TOKEN'];
  await writeProjectConfig(f.root,f.config);
  const result=await runRollout(f);
  assert.equal(result.releaseAccepted,true);
  assert.equal(JSON.stringify(result).includes('test-only-NAKWOL_TEST_HOST_TOKEN'),false);
});
