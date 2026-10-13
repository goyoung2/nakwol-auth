import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {installIntegration,inspectIntegration} from '../src/integration.mjs';
import {writeProjectConfig,readProjectConfig} from '../src/config.mjs';
import {doctorProject,initProject,syncProject,addUrlProject,dataSetProject} from '../src/commands.mjs';
const origin='https://nakwol-production.example';
test('HTML and Next.js installation use configured AUTH authority and expose the same inspected setting',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nakwol-origin-render-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [framework,targetFile,source]of [['html','index.html','<html><body>Private</body></html>'],['next_app','layout.tsx','export default function Layout(){return <html><body>Private</body></html>}']]){
  await writeFile(join(root,targetFile),source);const project={framework,targetFile};await installIntegration(root,project,'existing-app',{authOrigin:origin,authMode:'required'});await installIntegration(root,project,'existing-app',{authOrigin:origin,authMode:'required'});
  const installed=await readFile(join(root,targetFile),'utf8');const src=installed.match(/src="([^"]+)"/)[1];assert.equal(new URL(src).origin,origin);assert.equal(new URL(src).pathname,'/connect/v1.js');assert.equal((installed.match(/NAKWOL-CONNECT:START/g)||[]).length,1);
  const marker=await inspectIntegration(root,project);assert.equal(marker.authOrigin,origin);assert.equal(marker.clientId,'existing-app');assert.equal(marker.authMode,'required');
  await assert.rejects(()=>installIntegration(root,project,'existing-app',{authOrigin:'https://auth.example/path'}),/CONNECT_INVALID_AUTH_ORIGIN/);assert.equal(await readFile(join(root,targetFile),'utf8'),installed);
 }
});
test('real CLI switches Embed and server gate together, then default update preserves the saved authority and policy',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nakwol-origin-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'dist'));
 await writeFile(join(root,'package.json'),JSON.stringify({name:'existing-app',scripts:{build:'echo build'}}));await writeFile(join(root,'index.html'),'<html><body>Private</body></html>');await writeFile(join(root,'dist/index.html'),'<html><body>Private</body></html>');await writeFile(join(root,'dist/private.json'),'{}');
 await writeProjectConfig(root,{clientId:'existing-app',framework:'html',redirectUris:['https://service.example/'],integration:'universal-embed',authMode:'required',accessPolicy:'member'});
 const cli=fileURLToPath(new URL('../bin/nakwol-connect.mjs',import.meta.url));const run=args=>{const r=spawnSync(process.execPath,[cli,...args,'--json'],{cwd:root,encoding:'utf8',env:{...process.env,NAKWOL_AUTH_ORIGIN:''},timeout:15000});assert.equal(r.status,0,r.stderr+r.stdout);return JSON.parse(r.stdout);};
 run(['protect','install','--provider','cloudflare-workers','--assets','dist','--url','https://service.example/','--auth-origin',origin]);
 run(['protect','update']);const config=await readProjectConfig(root);assert.equal(config.authOrigin,origin);assert.equal(config.protection.authOrigin,origin);assert.equal(config.clientId,'existing-app');assert.equal(config.authMode,'required');assert.equal(config.accessPolicy,'member');
 const marker=await inspectIntegration(root,{framework:'html',targetFile:'index.html'});assert.equal(marker.authOrigin,origin);
 assert.equal((await doctorProject({root,offline:true})).checks.find(c=>c.name==='marker_auth_origin').ok,true);
 let networkCalls=0;const mutationOptions={root,authOrigin:'https://other-auth.example',fetchImpl:async()=>{networkCalls++;throw new Error('must not call network');}};
 const snapshot=await readFile(join(root,'.nakwol-connect.json'),'utf8');const beforeHtml=await readFile(join(root,'index.html'),'utf8');
 for(const mutate of [()=>initProject(mutationOptions),()=>syncProject(mutationOptions),()=>addUrlProject('https://other-site.example/',mutationOptions),()=>dataSetProject([],mutationOptions)])await assert.rejects(mutate,/protect install --auth-origin/);
 assert.equal(networkCalls,0);assert.equal(await readFile(join(root,'.nakwol-connect.json'),'utf8'),snapshot);assert.equal(await readFile(join(root,'index.html'),'utf8'),beforeHtml);

 await installIntegration(root,{framework:'html',targetFile:'index.html'},config.clientId,{authOrigin:'https://wrong.example',authMode:'required',dataOrigin:config.dataOrigin,dataScopes:config.dataScopes});
 assert.equal((await doctorProject({root,offline:true})).checks.find(c=>c.name==='marker_auth_origin').ok,false);
});
