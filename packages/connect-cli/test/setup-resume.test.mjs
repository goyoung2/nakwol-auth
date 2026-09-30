import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseSetup,SetupError} from '../src/shared/setup-schema.mjs';
import {installProtection,updateProtection,inspectProtection} from '../src/protection.mjs';
import {readProjectConfig} from '../src/config.mjs';

const setup=()=>({schemaVersion:1,clientId:'a',siteOrigin:'https://site.test',provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:2,policyVersion:3,step:'install',idempotencyKey:'11111111-1111-4111-8111-111111111111'});
test('shared setup boundary rejects secrets, executable paths, arbitrary origins and unsupported completion claims',()=>{
 assert.deepEqual(parseSetup(setup()),setup());
 for(const patch of [{secret:'private'},{step:'complete'},{siteOrigin:'https://site.test/path'},{siteOrigin:'https://u:p@site.test'},{buildDirectory:'../private'},{buildDirectory:'.'},{buildDirectory:'dist/../../private'},{provider:'github-pages'}])assert.throws(()=>parseSetup({...setup(),...patch}),SetupError);
});
for(const provider of ['cloudflare-workers','cloudflare-pages','vercel'])test(`${provider} setup-file installs existing selected app, resumes without central writes and preserves unrelated source/CI`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'nakwol-setup-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'dist'));await mkdir(join(root,'.github/workflows'),{recursive:true});
 await writeFile(join(root,'index.html'),'<html><body>private</body></html>');await writeFile(join(root,'dist/index.html'),'private');await writeFile(join(root,'dist/image.webp'),'private-image');await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'vite build'}}));await writeFile(join(root,'.github/workflows/custom.yml'),'CUSTOM CI');
 const document={...setup(),provider};await writeFile(join(root,'setup.json'),JSON.stringify(document));let reads=0;
 const fetchImpl=async(url,options)=>{assert.equal(options?.method||'GET','GET','setup install cannot mutate central state');reads++;if(String(url).endsWith('/setup/'+document.idempotencyKey))return Response.json({data:{setup:document,stale:false,app:{client_id:'a',access_policy:'member',redirect_uris:['https://site.test/','https://site.test/__nakwol/callback']}}});throw new Error('unexpected request '+url);};
 // Existing CLI session is authentication; exported resume JSON is not.
 await writeFile(join(root,'cli-session.json'),JSON.stringify({accessToken:'fixture',expiresAt:Date.now()+3600000}));
 const options={root,setupFile:'setup.json',sessionPath:join(root,'cli-session.json'),authOrigin:'https://auth.test',fetchImpl};
 const first=await installProtection(options);assert.equal(first.protectionStatus,'configured');assert.equal(first.setupStatus.deployment,'unverified');assert.equal(first.setupStatus.central,'saved');assert.equal((await readProjectConfig(root)).clientId,'a');
 await updateProtection(options);assert.ok((await inspectProtection(root,await readProjectConfig(root))).ok);assert.equal(await readFile(join(root,'.github/workflows/custom.yml'),'utf8'),'CUSTOM CI');assert.ok(reads>=2);
 const before=await readFile(join(root,'package.json'),'utf8');await assert.rejects(installProtection({...options,url:'https://different.test/'}),/SETUP_OPTION_CONFLICT/);assert.equal(await readFile(join(root,'package.json'),'utf8'),before);
});
