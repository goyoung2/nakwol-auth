import test from 'node:test';
import assert from 'node:assert/strict';
import {serveProtected} from '../src/server/gate.mjs';

test('negotiated policy clamps lease and requires fresh AUTH after 60 seconds',async t=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let now=originalNow(),calls=0;
 t.after(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;});Date.now=()=>now;
 const settings={clientId:'policy-test',siteUrl:'https://policy.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
 const env={NAKWOL_SESSION_SECRET:'test-secret-more-than-thirty-two-characters',ASSETS:{fetch:()=>new Response('PRIVATE')}};
 globalThis.fetch=async()=>{calls++;return Response.json({ok:true,data:{id:'u',status:'active',membership:{is_member:true}},application_access:{client_id:settings.clientId,allowed:true,source:'policy'},expires_at:now+3600000,authorization_policy:{schemaVersion:1,accessPolicy:'member',policyVersion:2,leaseSeconds:60,authorizationEvidenceValidUntil:now+300000,capabilities:['policy-v1']}});};
 const login=await serveProtected(new Request('https://policy.test/__nakwol/session',{method:'POST',headers:{Origin:'https://policy.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'dynamic-fixture'})}),env,settings);
 assert.equal(login.status,204);const cookie=login.headers.get('Set-Cookie').split(';')[0];
 now+=59000;
 await Promise.all(Array.from({length:300},()=>serveProtected(new Request('https://policy.test/img.webp',{headers:{Cookie:cookie}}),env,settings)));
 assert.equal(calls,1);
 now+=2000;
 globalThis.fetch=async()=>{calls++;return new Response(null,{status:503});};
 assert.equal((await serveProtected(new Request('https://policy.test/img.webp',{headers:{Cookie:cookie}}),env,settings)).status,503);
 assert.equal(calls,2);
});

for(const policy of [{schemaVersion:1,accessPolicy:'member',policyVersion:1,leaseSeconds:301,authorizationEvidenceValidUntil:Date.now()+300000},{schemaVersion:1,accessPolicy:'member',policyVersion:1,leaseSeconds:60,authorizationEvidenceValidUntil:0}])test('malformed or expired negotiated authorization cannot mint a session',async t=>{
 const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
 globalThis.fetch=async()=>Response.json({ok:true,data:{id:'u',status:'active',membership:{is_member:true}},application_access:{client_id:'invalid-policy',allowed:true,source:'policy'},expires_at:Date.now()+3600000,authorization_policy:policy});
 const response=await serveProtected(new Request('https://policy.test/__nakwol/session',{method:'POST',headers:{Origin:'https://policy.test','Content-Type':'application/json'},body:JSON.stringify({access_token:JSON.stringify(policy)})}),{NAKWOL_SESSION_SECRET:'test-secret-more-than-thirty-two-characters'}, {clientId:'invalid-policy',siteUrl:'https://policy.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
 assert.notEqual(response.status,204);
});

test('central guest policy is authoritative and evidence expiry bounds local authorization',async t=>{
 const beforeFetch=globalThis.fetch,beforeNow=Date.now;let now=beforeNow(),calls=0;
 t.after(()=>{globalThis.fetch=beforeFetch;Date.now=beforeNow;});Date.now=()=>now;
 const settings={clientId:'guest-policy',siteUrl:'https://guest.test/',authOrigin:'https://auth.test',accessPolicy:'member'};
 const env={NAKWOL_SESSION_SECRET:'test-secret-more-than-thirty-two-characters',ASSETS:{fetch:()=>new Response('PRIVATE')}};
 globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init.headers['X-Nakwol-Capabilities'],'policy-v1');return Response.json({ok:true,data:{id:'guest',status:'active',membership:{is_member:false}},application_access:{client_id:settings.clientId,allowed:true,source:'policy'},expires_at:now+3600000,authorization_policy:{schemaVersion:1,accessPolicy:'guest',policyVersion:5,leaseSeconds:300,authorizationEvidenceValidUntil:now+2000}});};
 const login=await serveProtected(new Request('https://guest.test/__nakwol/session',{method:'POST',headers:{Origin:'https://guest.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'guest-evidence-fixture'})}),env,settings);
 assert.equal(login.status,204);const cookie=login.headers.get('Set-Cookie').split(';')[0];
 const request=()=>new Request('https://guest.test/data.json',{headers:{Cookie:cookie}});
 assert.equal((await serveProtected(request(),env,settings)).status,200);assert.equal(calls,1);
 now+=2001;globalThis.fetch=async()=>{calls++;return new Response(null,{status:403});};
 assert.equal((await serveProtected(request(),env,settings)).status,403);assert.equal(calls,2);
});
