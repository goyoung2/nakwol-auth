import test from 'node:test';import assert from 'node:assert/strict';
import {sealHostingState,openHostingState} from '../src/hosting-state.mjs';
const binding={clientId:'site',siteOrigin:'https://site.test',provider:'vercel',resourceId:'prj_site',accountId:'',teamId:'team_site'},secret='a'.repeat(64),state={schemaVersion:1,manifest:{private:'canary-secret'},report:{releaseAccepted:true}};
test('sealed baseline is opaque, authenticated and scoped to app/origin/provider/resource/team',()=>{
 const sealed=sealHostingState(binding,state,secret);assert.ok(!sealed.includes('canary-secret'));assert.deepEqual(openHostingState(binding,sealed,secret),state);
 for(const field of ['clientId','siteOrigin','provider','resourceId','accountId','teamId'])assert.throws(()=>openHostingState({...binding,[field]:'other'},sealed,secret),/invalid/);
 assert.throws(()=>openHostingState(binding,sealed,'b'.repeat(64)),/invalid/);
 const changed=JSON.parse(sealed);changed.tag='0'.repeat(32);assert.throws(()=>openHostingState(binding,JSON.stringify(changed),secret),/invalid/);
 assert.notEqual(sealHostingState(binding,state,secret),sealed);assert.throws(()=>sealHostingState(binding,state,'too-short'),/32-byte/);
});
