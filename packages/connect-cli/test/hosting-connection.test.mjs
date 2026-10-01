import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseHosting} from '../src/shared/hosting-schema.mjs';
import {connectHosting,planHosting} from '../src/hosting-connection.mjs';
import {installProtection,updateProtection} from '../src/protection.mjs';
import {writeProjectConfig,readProjectConfig} from '../src/config.mjs';
const binding=(provider='cloudflare-workers')=>({schemaVersion:1,clientId:'site',siteOrigin:'https://site.test',provider,accountId:'a'.repeat(32),resourceId:'site',teamId:'',mode:'manual',controlledDeployments:false,origins:['https://site.test'],adapterFile:''});
async function fixture(t,provider='cloudflare-workers'){
 const root=await mkdtemp(join(tmpdir(),'nakwol-hosting-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'dist'));await writeFile(join(root,'index.html'),'<html><body>site</body></html>');await writeFile(join(root,'dist/index.html'),'private');
 await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'echo build'}}));
 await writeProjectConfig(root,{clientId:'site',authMode:'required',accessPolicy:'member',redirectUris:['https://site.test/']});
 await installProtection({root,provider,assets:'dist',url:'https://site.test/'});return root;
}
test('hosting JSON rejects secrets, shell injection, origins and automatic mode without serialization',()=>{
 assert.equal(parseHosting(binding()).mode,'manual');
 for(const patch of [{token:'secret'},{resourceId:'site; echo bad'},{siteOrigin:'http://site.test'},{origins:['https://other.test']},{mode:'automatic'},{accountId:'wrong'}])assert.throws(()=>parseHosting({...binding(),...patch}));
});
for(const provider of ['cloudflare-workers','cloudflare-pages','vercel'])test(`${provider}: connection templates are secret-free, non-deploying, and retain existing config`,async t=>{
 const root=await fixture(t,provider),document=provider==='vercel'?{...binding(provider),accountId:'',resourceId:'prj_site',teamId:'team_site'}:binding(provider);
 const file=join(root,'nakwol-hosting.json');await writeFile(file,JSON.stringify(document));
 await writeFile(join(root,'.gitignore'),'owner-rule\n!.nakwol/reports/');
 const before=await readProjectConfig(root);const plan=await planHosting({root,hostingFile:file});assert.equal(plan.status,'planned-not-connected');
 const result=await connectHosting({root,hostingFile:file});assert.equal(result.status,'configured-not-deployed');
 const config=await readProjectConfig(root);assert.equal(config.clientId,before.clientId);assert.equal(config.protection.automatic,undefined);
 assert.equal(await readFile(join(root,'.gitignore'),'utf8'),'owner-rule\n!.nakwol/reports/\n.nakwol/reports/\n');
 const workflow=await readFile(join(root,'.github/workflows/nakwol-hosting.yml'),'utf8');
 assert.match(workflow,/workflow_dispatch/);assert.doesNotMatch(workflow,/pull_request_target|nakwol-connect@latest/);
 assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/cancel-in-progress: false/);
 assert.match(workflow,/protect hosting check/);assert.match(workflow,/protect hosting verify/);
 assert.doesNotMatch(workflow,/run:.*(?:wrangler deploy|vercel --prod)/);
 assert.equal(config.protection.hosting.mode,'manual');
  await updateProtection({root});assert.deepEqual((await readProjectConfig(root)).protection.hosting,config.protection.hosting);
 const after=await readFile(join(root,'.nakwol-connect.json'),'utf8');await assert.rejects(connectHosting({root,hostingFile:file}),/Existing/);
 assert.equal(await readFile(join(root,'.nakwol-connect.json'),'utf8'),after);
});
test('connection rejects mismatched app/site/provider and existing CI before writing',async t=>{
 const root=await fixture(t),file=join(root,'nakwol-hosting.json');
 for(const patch of [{clientId:'other'},{siteOrigin:'https://other.test',origins:['https://other.test']},{provider:'cloudflare-pages'}]){
  await writeFile(file,JSON.stringify({...binding(),...patch}));await assert.rejects(connectHosting({root,hostingFile:file}),/binding/);
 }
 await writeFile(file,JSON.stringify(binding()));await mkdir(join(root,'.github/workflows'),{recursive:true});await writeFile(join(root,'.github/workflows/nakwol-hosting.yml'),'owner');
 await assert.rejects(connectHosting({root,hostingFile:file}),/Existing/);assert.equal((await readProjectConfig(root)).protection.hosting,undefined);
});

test('native inventories query only the selected project, include previews and aliases, and never mutate hosting',async t=>{
 const {checkHosting}=await import('../src/hosting-connection.mjs');
 process.env.CLOUDFLARE_API_TOKEN='private-read-token';process.env.VERCEL_TOKEN='private-vercel-token';t.after(()=>{delete process.env.CLOUDFLARE_API_TOKEN;delete process.env.VERCEL_TOKEN;});
 for(const provider of ['cloudflare-workers','cloudflare-pages','vercel']){
  const root=await fixture(t,provider),bindingValue=provider==='vercel'?{...binding(provider),accountId:'',resourceId:'prj_site',teamId:'team_site'}:binding(provider);
  const file=join(root,'nakwol-hosting.json');await writeFile(file,JSON.stringify(bindingValue));await connectHosting({root,hostingFile:file});const seen=[];
  const fetchImpl=async(url,init)=>{seen.push(String(url));assert.equal(init.method,'GET');assert.equal(init.redirect,'error');let data;
   if(provider==='cloudflare-workers')data=String(url).endsWith('/deployments')?{deployments:[{id:'current',versions:[{version_id:'v1',percentage:100}]}]}:String(url).endsWith('/scripts/site/subdomain')?{enabled:false,previews_enabled:false}:[];
   if(provider==='cloudflare-pages')data=String(url).includes('/deployments?')?[{url:'https://old.site.pages.dev',aliases:['https://branch.site.pages.dev']}]:{name:'site',subdomain:'site.pages.dev',domains:['custom.site.test'],canonical_deployment:{id:'current'}};
   if(provider==='vercel')data=String(url).includes('/v6/deployments')?{deployments:[{projectId:'prj_site',url:'old-site.vercel.app'}],pagination:{next:null}}:String(url).includes('/domains?')?{domains:[{name:'custom.site.test'}],pagination:{next:null}}:String(url).includes('/v4/aliases?')?{aliases:[{projectId:'prj_site',alias:'branch-site.vercel.app'}],pagination:{next:null}}:{id:'prj_site',accountId:'team_site',targets:{production:{id:'current'}}};
   return new Response(JSON.stringify(provider==='vercel'?data:{success:true,result:data}));};
  const result=await checkHosting({root,fetchImpl});assert.equal(result.deploymentId,'current');assert.equal(result.inventoryComplete,true);assert.equal(result.origins.includes('https://site.test/'),true);
  if(provider!=='cloudflare-workers')assert.equal(result.origins.some(v=>v.includes('old')),true);
  if(provider==='vercel'){assert.equal(result.origins.includes('https://branch-site.vercel.app/'),true);assert.ok(seen.every(v=>v.includes('teamId=team_site')));}
  assert.equal(JSON.stringify(result).includes('private-read-token'),false);
  await assert.rejects(checkHosting({root,fetchImpl:async()=>new Response('bad',{status:500})}),/API failed/);
 }
});

test('custom build hooks are never overwritten and the CLI wizard exports only public manual settings',async t=>{
 const {hostingWizard}=await import('../src/hosting-wizard.mjs');const root=await fixture(t);const answers=['a'.repeat(32),'https://preview.test'];
 const wizard=await hostingWizard({root,ask:async()=>answers.shift()});assert.equal(wizard.status,'wizard-exported-not-connected');const document=JSON.parse(await readFile(wizard.hostingFile,'utf8'));assert.equal(document.mode,'manual');assert.equal(document.controlledDeployments,false);assert.equal(document.origins.length,2);
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));pkg.scripts['nakwol:gate']='owner-custom-gate';await writeFile(join(root,'package.json'),JSON.stringify(pkg));
 await assert.rejects(connectHosting({root,hostingFile:wizard.hostingFile}),/custom/);assert.equal((await readProjectConfig(root)).protection.hosting,undefined);
});

test('an exact production SDK dependency remains usable through connection and managed gate update',async t=>{
 const root=await fixture(t),pkg=JSON.parse(await readFile(join(root,'package.json'))),version=(await readProjectConfig(root)).protection.runtimeVersion;pkg.dependencies={'nakwol-connect':version};await writeFile(join(root,'package.json'),JSON.stringify(pkg));
 const file=join(root,'nakwol-hosting.json');await writeFile(file,JSON.stringify(binding()));await connectHosting({root,hostingFile:file});await updateProtection({root});
 const updated=JSON.parse(await readFile(join(root,'package.json')));assert.equal(updated.dependencies['nakwol-connect'],version);assert.equal(updated.devDependencies?.['nakwol-connect'],undefined);assert.equal((await readProjectConfig(root)).protection.hosting.mode,'manual');
});
