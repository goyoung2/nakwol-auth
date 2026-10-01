import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {parseSetup} from '../../packages/connect-cli/src/shared/setup-schema.mjs';
import {parsePresentation, defaultPresentation} from '../../packages/connect-cli/src/shared/presentation-schema.mjs';

class Element {
 value='';textContent='';hidden=false;disabled=false;dateTime='';dataset={};children=[];listeners=new Map();style={};
 append(node){this.children.push(node);} add(node){this.append(node);} replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;} removeAttribute(key){delete this[key];}
 addEventListener(name,listener){this.listeners.set(name,listener);}
 async fire(name){await (this.listeners.get(name)||this['on'+name])?.({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}
}
const oldKey='11111111-1111-4111-8111-111111111111';
const original={schemaVersion:1,clientId:'a',siteOrigin:'https://old.test',provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:0,policyVersion:7,step:'install',idempotencyKey:oldKey};
const policy={policyVersion:7,stored:{},effective:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:14400,leaseSeconds:120,accessTokenSeconds:3600},accessPolicy:'member'};
const capabilities={capabilities:['policy:read','policy:write'],editablePolicy:['sessionIdleSeconds','sessionAbsoluteSeconds','leaseSeconds'],ranges:{sessionIdleSeconds:{min:3600,max:864000},sessionAbsoluteSeconds:{min:3600,max:2592000},leaseSeconds:{min:60,max:300}}};
const result=data=>({ok:true,status:200,json:async()=>({data})});
async function driver(asset,request,extra={}){
 const source=process.env.NAKWOL_UI_BASELINE==='HEAD'?execFileSync('git',['show','HEAD:src/assets/'+asset],{encoding:'utf8'}):await readFile(new URL('../../src/assets/'+asset,import.meta.url),'utf8'),elements=new Map(),calls=[],logins=[],storage=new Map(extra.storageEntries),confirmations=[],redirects=[];
 const node=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const fields=new Map(),field=name=>{if(!fields.has(name))fields.set(name,new Element());return fields.get(name);};node('#app-form').elements={namedItem:field};
 const context=vm.createContext({NakwolAuthClient:class {getAccessToken(){return 'token';}async bootstrap(){return {id:'owner'};}async login(options){logins.push(options);}},parseSetup,parsePresentation,Headers,FormData:class {get(name){return field(name).disabled?null:field(name).value;}},
 document:{getElementById:node,querySelector:node,createElement:()=>new Element(),querySelectorAll:()=>[]},Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},
 location:{origin:'https://auth.test',href:'https://auth.test/developer/setup?client_id=a',search:'?client_id=a',replace:value=>redirects.push(value)},history:{replaceState(){}},URL,URLSearchParams,AbortSignal,Blob,structuredClone,console,
 crypto:{randomUUID:(()=>{let n=0;return ()=>`22222222-2222-4222-8222-${String(++n).padStart(12,'0')}`;})()},
 confirm:message=>{confirmations.push(message);return extra.confirm!==false;},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
 window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout,
 fetch:async(path,init={})=>{const call={path,method:init.method||'GET',body:init.body?JSON.parse(init.body):undefined};calls.push(call);return request(call);}});
 vm.runInContext(source.replace(/^import[^\n]*\n/gm,''),context);await new Promise(resolve=>setImmediate(resolve));
 return {node,field,calls,logins,storage,confirmations,redirects,run:code=>vm.runInContext(code,context),state:()=>vm.runInContext('({selected,record,setup,busy})',context)};
}
async function wizard(extra={}){
 const records=new Map([[oldKey,{setup:structuredClone(original),version:4}]]);
 const issued=new Map([[oldKey,{credentialId:'sc_old',clientId:'a',siteOrigin:'https://old.test',secretAvailable:false,revoked:false}]]);
 const draft=defaultPresentation('a');
 const ui=await driver('nakwol-developer-setup.js.txt',({path,method,body})=>{
  if(path==='/developer/v1/apps')return result({apps:[{client_id:'a',name:'A'}]});
  if(path.endsWith('/presentation/draft'))return result({draft,version:0,publishedVersion:0});
  if(path.endsWith('/policy'))return result(policy);
  if(path.endsWith('/capabilities'))return result(capabilities);
  if(path.endsWith('/site-credentials/sc_old/revoke')){assert.deepEqual(Object.keys(body),['reason']);issued.get(oldKey).revoked=true;return result({revoked:true});}
  if(path.endsWith('/setup')&&method==='GET')return result({setups:[{id:oldKey,version:4}]});
  if(path.endsWith('/setup')&&method==='POST'){
   if(extra.failNextSave)return {ok:false,status:401,json:async()=>({error:{code:'UNAUTHENTICATED'}})};
   const previous=records.get(body.setup.idempotencyKey);assert.equal(body.expectedVersion,previous?.version??0);
   if(previous&&issued.has(body.setup.idempotencyKey))assert.equal(body.setup.siteOrigin,previous.setup.siteOrigin);
   const saved={setup:body.setup,version:(previous?.version??0)+1};records.set(body.setup.idempotencyKey,saved);return result(saved);
  }
  if(path.endsWith('/credential')){
   const key=path.split('/').at(-2),saved=records.get(key);assert.equal(body.expectedVersion,saved.version);
   if(issued.has(key))return result(issued.get(key));
   const receipt={credentialId:'sc_new',clientId:'a',siteOrigin:saved.setup.siteOrigin,secret:'only-delivery',secretAvailable:true};issued.set(key,{...receipt,secret:undefined,secretAvailable:false});return result(receipt);
  }
  const key=path.split('/').at(-1);if(records.has(key))return result(records.get(key));throw new Error('Unexpected '+method+' '+path);
 },extra);
 ui.node('reason').value='서비스 설치 및 재설정';return {...ui,records,issued};
}

test('same app new setup starts with a fresh key and zero CAS version for a different origin',async()=>{
 const ui=await wizard();assert.equal(ui.state().setup.idempotencyKey,oldKey);
 await ui.node('new-setup').fire('click');const key=ui.state().setup.idempotencyKey;
 assert.notEqual(key,oldKey);assert.equal(ui.state().record,null);assert.equal(ui.state().setup.step,'hosting');
 ui.node('site-origin').value='https://new.test';await ui.node('save').fire('click');
 const saved=ui.calls.findLast(call=>call.method==='POST'&&call.path.endsWith('/setup'));
 assert.equal(saved.body.expectedVersion,0);assert.equal(saved.body.setup.idempotencyKey,key);assert.equal(saved.body.setup.clientId,'a');assert.equal(saved.body.setup.siteOrigin,'https://new.test');
 assert.equal(ui.records.get(oldKey).setup.siteOrigin,'https://old.test');assert.equal(ui.calls.some(call=>call.path==='/developer/v1/setup/apps'),false);
 assert.equal(ui.issued.get(oldKey).revoked,false);assert.equal(ui.calls.some(call=>call.path.endsWith('/revoke')),false);
});

test('credential replacement confirms the owned receipt, revokes with reason, and issues once from new setup version',async()=>{
 const ui=await wizard();await ui.node('credential').fire('click');assert.equal(ui.node('secret').hidden,true);
 await ui.node('replace-credential').fire('click');
 const revoked=ui.calls.find(call=>call.path.endsWith('/sc_old/revoke'));assert.ok(revoked);assert.equal(revoked.body.reason,'서비스 설치 및 재설정');assert.equal(ui.confirmations.length,1);
 const posts=ui.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/setup')),replacement=posts.at(-1);
 assert.notEqual(replacement.body.setup.idempotencyKey,oldKey);assert.equal(replacement.body.expectedVersion,0);
 const credential=ui.calls.filter(call=>call.path.endsWith('/credential')).at(-1);assert.equal(credential.body.expectedVersion,1);assert.ok(credential.path.includes(replacement.body.setup.idempotencyKey));
 assert.equal(ui.node('secret').value,'only-delivery');assert.equal(ui.issued.get(oldKey).revoked,true);
 await ui.node('credential').fire('click');assert.equal(ui.node('secret').value,'');assert.equal(ui.node('secret').hidden,true);
});

test('cancelling revocation posts nothing and setup reauthentication retains app return',async()=>{
 const ui=await wizard({confirm:false});await ui.node('credential').fire('click');await ui.node('revoke-credential').fire('click');
 assert.equal(ui.calls.some(call=>call.path.endsWith('/revoke')),false);
 await ui.node('login').fire('click');assert.equal(ui.storage.get('nakwol.developer.setup.return'),'a');assert.equal(ui.logins[0].reauthenticate,true);
});

test('policy save retains its operation and refreshes scoped publication and observation times',async()=>{
 const control={receipts:[{clientId:'a',operationId:'control-7',version:12,deliveryStatus:'published',publishedAt:2000,observedAt:null}]};
 const ui=await driver('nakwol-service-management.js.txt',({path,method})=>{
  if(path==='/developer/v1/apps')return result({apps:[{client_id:'a',name:'A'}],isOperator:false});
  if(path.endsWith('/capabilities'))return result(capabilities);
  if(path.endsWith('/operations/policy-7'))return result({operationId:'policy-7',clientId:'a',policyVersion:8,createdAt:1000,deliveryStatus:'published',control:{receipts:[{...control.receipts[0],observedAt:3000}]},siteProfile:'unconfirmed',allUsersObserved:false});
  return result(method==='PUT'?{...policy,policyVersion:8,operationId:'policy-7',control}:policy);
 });
 ui.node('reason').value='update lifetime';await ui.node('policy-form').fire('submit');
 assert.ok(ui.calls.some(call=>call.path==='/developer/v1/apps/a/operations/policy-7'));
 assert.equal(ui.node('operation-id').textContent,'policy-7');assert.equal(ui.node('operation-status').dataset.status,'published');
 assert.equal(ui.node('accepted-at').dateTime,new Date(1000).toISOString());assert.equal(ui.node('published-at').dateTime,new Date(2000).toISOString());assert.equal(ui.node('observed-at').dateTime,new Date(3000).toISOString());
 assert.equal(ui.node('operation').dataset.siteProfile,'unconfirmed');assert.equal(ui.node('operation').dataset.allUsersObserved,'false');
});

test('admin OAuth callback returns to fixed setup route and consumes invalid targets safely',async()=>{
 for(const [value,target] of [['a','/developer/setup?client_id=a'],['https://other.test/path','/developer/setup']]){
  const ui=await driver('nakwol-connect-admin.js.txt',()=>{throw new Error('Operator APIs must not precede setup return');},{storageEntries:[['nakwol.developer.setup.return',value]]});
  assert.deepEqual(ui.redirects,[target]);assert.equal(ui.storage.has('nakwol.developer.setup.return'),false);assert.equal(ui.calls.length,0);
 }
});

test('existing admin app metadata excludes disabled status while creation retains the chosen initial status',async()=>{
 const ui=await driver('nakwol-connect-admin.js.txt',()=>{throw new Error('No network expected');},{storageEntries:[['nakwol.developer.setup.return','a']]});
 ui.run("state.creating=false;fillForm({client_id:'a',name:'Locked app',status:'disabled'});");
 assert.equal(ui.field('status').disabled,true);assert.equal(ui.field('status').value,'disabled');assert.equal(Object.hasOwn(ui.run('getFormData()'),'status'),false);
 ui.run('state.creating=true;fillForm(null);');ui.field('status').value='disabled';
 assert.equal(ui.field('status').disabled,false);assert.equal(ui.run('getFormData()').status,'disabled');
});

test('a failed checkpoint clears the previous one-delivery secret before the credential request',async()=>{
 const options={},ui=await wizard(options);await ui.node('new-setup').fire('click');await ui.node('credential').fire('click');assert.equal(ui.node('secret').value,'only-delivery');
 options.failNextSave=true;const issued=ui.calls.filter(call=>call.path.endsWith('/credential')).length;await ui.node('credential').fire('click');
 assert.equal(ui.node('secret').value,'');assert.equal(ui.node('secret').hidden,true);assert.equal(ui.calls.filter(call=>call.path.endsWith('/credential')).length,issued);
});
