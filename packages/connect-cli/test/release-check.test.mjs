import {createHash} from 'node:crypto';
import {protectionBuildHash} from '../src/protection-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeProjectConfig,readProjectConfig} from '../src/config.mjs';
import {installProtection} from '../src/protection.mjs';
import {checkRelease} from '../src/release-check.mjs';
import {createGate,RUNTIME_VERSION} from '../src/server/gate.mjs';
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'release-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'private');await writeFile(join(root,'index.html'),'<body></body>');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'echo build'}}));
  await writeProjectConfig(root,{clientId:'site',redirectUris:['https://site.test/']});await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
  const config=await readProjectConfig(root);config.protection.rollback={enabled:true,provider:'cloudflare-workers',accountId:'account',scriptName:'site',serializedDeployments:true};await writeProjectConfig(root,config);
  const gate=createGate({clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
  let active='old',leak=false,writes=0;
  const fetchImpl=async(url,init)=>{
    if(init.method==='POST'){writes++;active='recovery';leak=false;return Response.json({success:true,result:{id:active}});}
    const result=String(url).endsWith('/old')?{id:'old',created_on:'2026-09-01T00:00:00Z',versions:[{version_id:'old-version',percentage:100}]}:{deployments:[{id:active,created_on:active==='old'?'2026-09-01T00:00:00Z':'2026-09-02T00:00:00Z'}]};
    return Response.json({success:true,result});
  };
  const verificationFetchImpl=(url,init)=>leak?Promise.resolve(new Response('private leaked')):gate(new Request(url,init),{sessionSecret:'test-only-session-secret-32-characters',serveAsset:()=>{throw Error('leak');}});
  return {root,config,fetchImpl,verificationFetchImpl,setCurrent(id,exposed){active=id;leak=exposed;},writes:()=>writes};
}
test('release check refuses anonymous-only rollback baselines',async t=>{
  const f=await fixture(t);const outputFile=join(f.root,'release.json');
  const baseline=await checkRelease({...f,apiToken:'test',deploymentId:'old',outputFile,baseline:true});assert.equal(baseline.ok,false);assert.equal(baseline.anonymousBlockingVerified,true);assert.equal(baseline.releaseAccepted,false);
  f.config.protection.rollback.previousVerified={deploymentId:'old',runtimeVersion:RUNTIME_VERSION,report:{...baseline,ok:true}};await writeProjectConfig(f.root,f.config);
  f.setCurrent('failed',true);
  await assert.rejects(checkRelease({...f,apiToken:'test',deploymentId:'failed',outputFile}),/re-verification/);assert.equal(f.writes(),0);
});
test('release check refuses stale provider IDs before asset probing',async t=>{
  const f=await fixture(t);await assert.rejects(checkRelease({...f,apiToken:'test',deploymentId:'new',outputFile:join(f.root,'report.json')}),/no longer serving/);assert.equal(f.writes(),0);
});

test('release acceptance binds authenticated bytes to a stable provider deployment',async t=>{
 const f=await fixture(t),manifest=join(f.root,'manifest.json');
 const digest=createHash('sha256').update('private').digest('hex');
 await writeFile(manifest,JSON.stringify({schemaVersion:1,deploymentId:'old',buildHash:protectionBuildHash([{path:'/index.html',size:7,sha256:digest}]),runtimeVersion:RUNTIME_VERSION,capabilities:['all-assets'],files:[{path:'/index.html',size:7,sha256:digest}]}));
 process.env.NAKWOL_RELEASE_TEST_COOKIE='__nakwol_session=test-only';t.after(()=>delete process.env.NAKWOL_RELEASE_TEST_COOKIE);
 const base=f.verificationFetchImpl;
 f.verificationFetchImpl=(url,init)=>init.headers?.Cookie===process.env.NAKWOL_RELEASE_TEST_COOKIE?Promise.resolve(new Response('private')):base(url,init);
 const result=await checkRelease({...f,manifest,sessionCookieEnv:'NAKWOL_RELEASE_TEST_COOKIE',apiToken:'test',deploymentId:'old',outputFile:join(f.root,'release.json'),baseline:true});
 assert.equal(result.releaseAccepted,true);assert.equal(result.evidenceBinding.deploymentId,'old');assert.equal(result.authenticatedChecks[0].ok,true);
 await assert.rejects(checkRelease({...f,manifest,apiToken:'test',deploymentId:'failed',outputFile:join(f.root,'wrong.json')}),/no longer serving/);
});
