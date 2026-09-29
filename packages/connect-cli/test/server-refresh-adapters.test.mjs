import test from 'node:test';
import assert from 'node:assert/strict';
import {generate as workers} from '../src/adapters/cloudflare-workers.mjs';
import {generate as pages} from '../src/adapters/cloudflare-pages.mjs';
import {generate as vercel} from '../src/adapters/vercel-static.mjs';
const input={settings:{clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'},projectName:'site'};
for(const [provider,generate] of Object.entries({workers,pages,vercel}))test(`${provider} includes the official server refresh runtime without embedding a credential`,async()=>{
 const files=await generate(input,{directory:'dist'});
 const runtime=provider==='pages'?files['dist/_worker.js']:files['.nakwol/server/session.mjs'];
 assert.equal(typeof runtime,'string');assert.match(runtime,/serveServerSession/);
 if(provider==='pages')assert.doesNotMatch(runtime,/import .*from '\.\/session.mjs'/);
 if(provider==='vercel')assert.match(files['middleware.js'],/siteCredential:process.env.NAKWOL_SITE_CREDENTIAL/);
 assert.doesNotMatch(JSON.stringify(files),/Bearer test-secret/);
});
