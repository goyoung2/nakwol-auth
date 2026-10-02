import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareSetup} from '../src/setup.mjs';

test('download remains usable after wizard navigation but configuration drift still rejects',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nakwol-setup-navigation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const setup={schemaVersion:1,clientId:'a',siteOrigin:'https://a.test',provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:2,policyVersion:1,step:'install',idempotencyKey:'11111111-1111-4111-8111-111111111111'};
 await writeFile(join(root,'nakwol-setup.json'),JSON.stringify(setup));await writeFile(join(root,'index.html'),'<html></html>');
 const sessionPath=join(root,'session.json');await writeFile(sessionPath,JSON.stringify({accessToken:'fixture',expiresAt:Date.now()+3600000}));
 let current={...setup,step:'verify'};
 const fetchImpl=async()=>Response.json({data:{setup:current,stale:false,app:{client_id:'a',status:'active',access_policy:'member',redirect_uris:['https://a.test/','https://a.test/__nakwol/callback']}}});
 const options={root,sessionPath,setupFile:'nakwol-setup.json',authOrigin:'https://auth.test',fetchImpl};
 assert.equal((await prepareSetup(options)).config.clientId,'a');
 current={...current,policyVersion:2};await assert.rejects(prepareSetup(options),/SETUP_CONFLICT_OR_STALE/);
});
