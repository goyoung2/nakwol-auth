import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  value = ''; textContent = ''; hidden = false; disabled = false; min = ''; max = '';
  children: Element[] = []; listeners = new Map<string, (event: {preventDefault(): void}) => unknown>();
  append(node: Element) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  addEventListener(name: string, listener: (event: {preventDefault(): void}) => unknown) { this.listeners.set(name, listener); }
  async fire(name: string) { await this.listeners.get(name)?.({preventDefault() {}}); }
}
async function driver(options: {write?: boolean; conflict?: boolean; authenticated?: boolean; operator?: boolean} = {}) {
  const source = await readFile(new URL('../../src/assets/nakwol-service-management.js.txt', import.meta.url),'utf8');
  const elements = new Map<string, Element>();
  const node = (id: string) => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id)!; };
  const calls: Array<{path: string; method?: string; body?: string}> = [];
  const logins: unknown[] = [], storage = new Map();
  const policy = {policyVersion:7,stored:{leaseSeconds:120},effective:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:14400,leaseSeconds:120,accessTokenSeconds:3600},accessPolicy:'member'};
  class Auth { getAccessToken() { return options.authenticated===false ? null : 'synthetic-token'; } async login(value: unknown) {logins.push(value);} }
  vm.runInNewContext(source.replace(/^import[^\n]+\n/,''),{
    NakwolAuthClient:Auth,location:{origin:'https://auth.test',search:'?client_id=other-app'},URLSearchParams,console,
    sessionStorage:{setItem:(key: string,value: string)=>storage.set(key,value)},
    document:{getElementById:node,createElement:()=>new Element()},
    fetch:async(path: string,init: {method?: string; body?: string})=>{
      calls.push({path,...init});
      if(init.method==='PUT' && options.conflict) return {ok:false,status:409,json:async()=>({error:{code:'POLICY_VERSION_CONFLICT'}})};
      const data = path.endsWith('/apps') ? {apps:[{client_id:'owned-app',name:'<img onerror=alert(1)>'}],isOperator:options.operator===true} : path.endsWith('/capabilities') ? {capabilities:options.write===false ? ['policy:read'] : ['policy:read','policy:write'],ranges:{sessionIdleSeconds:{min:3600,max:864000},sessionAbsoluteSeconds:{min:3600,max:2592000},leaseSeconds:{min:60,max:300}}} : path.endsWith('/preview') ? {...policy,previewToken:'preview-test'} : policy;
      return {ok:true,status:200,json:async()=>({data})};
    },
  });
  await new Promise(resolve=>setImmediate(resolve));
  return {node,calls,logins,storage,source};
}

test('owner console selects only server-returned apps, renders text and submits CAS seconds',async()=>{
  const {node,calls,source}=await driver();
  assert.equal(node('service').value,'owned-app');
  assert.equal(node('service').children[0].textContent,'<img onerror=alert(1)> · owned-app');
  assert.doesNotMatch(source,/innerHTML/);
  assert.equal(node('idle').value,'2');
  node('reason').value='시간 조정'; node('absolute').value='2';
  await node('policy-form').fire('submit');
  const request=calls.find(call=>call.method==='PUT');
  assert.equal(request?.path,'/developer/v1/apps/owned-app/policy');
  assert.deepEqual(JSON.parse(request!.body!),{expectedVersion:7,patch:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:7200,leaseSeconds:120},reason:'시간 조정'});
  assert.match(node('status').textContent,/저장했습니다/);
});

test('read-only capability and version conflict prevent unauthorized or stale resubmission',async()=>{
  const read=await driver({write:false});
  assert.equal(read.node('policy-fields').disabled,true);
  await read.node('policy-form').fire('submit'); assert.equal(read.calls.some(call=>call.method==='PUT'),false);
  const conflict=await driver({conflict:true}); conflict.node('reason').value='시간 조정';
  await conflict.node('policy-form').fire('submit');
  assert.match(conflict.node('status').textContent,/다른 관리자가/);
  assert.equal(conflict.node('policy-fields').disabled,true);
  await conflict.node('policy-form').fire('submit');
  assert.equal(conflict.calls.filter(call=>call.method==='PUT').length,1);
});

test('unauthenticated console fetches no PII and has working forced reauthentication return',async()=>{
  const {node,calls,logins,storage}=await driver({authenticated:false});
  assert.equal(calls.length,0); assert.equal(node('login').hidden,false);
  await node('login').fire('click');
  assert.equal(storage.has('nakwol.developer.return'),true);
  assert.equal(JSON.stringify(logins),JSON.stringify([{reauthenticate:true}]));
});

test('console shell explains effective policy and unobserved rollout without embedding account data',async()=>{
  const page=await readFile(new URL('../../src/service-management-page.ts',import.meta.url),'utf8');
  assert.match(page,/\[hidden\]\{display:none!important\}/); assert.match(page,/connectSharedStyles/); assert.match(page,/마지막 관측 버전: 미확인/);
  assert.match(page,/0.7.x·0.8.x/); assert.match(page,/T06/);
  assert.doesNotMatch(page,/access_token|discord_id|owner_user_id/);
});

 test('operator previews global and app changes, confirms exact payload, and invalidates edited preview',async()=>{
  const owner=await driver(); assert.equal(owner.node('service').children.length,1); assert.equal(owner.node('operator-token').hidden,true);
  const ui=await driver({operator:true});
  assert.equal(ui.node('service').children[0].value,'@global');
  assert.equal(ui.node('operator-access').hidden,false);
  ui.node('reason').value='접근 변경'; ui.node('access').value='guest';
  await ui.node('policy-form').fire('submit');
  const preview=ui.calls.find(call=>call.method==='POST');
  assert.equal(preview?.path,'/admin/api/auth-policy/owned-app/preview');
  assert.equal(JSON.parse(preview!.body!).patch.accessPolicy,'guest');
  assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  await ui.node('confirm').fire('click');
  assert.equal(JSON.parse(ui.calls.find(call=>call.method==='PUT')!.body!).previewToken,'preview-test');
  ui.node('service').value='@global'; await ui.node('service').fire('change');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.node('operator-access').hidden,true);
  ui.node('reason').value='전역 변경'; await ui.node('policy-form').fire('submit');
  assert.equal(ui.calls.filter(call=>call.method==='POST').at(-1)?.path,'/admin/api/auth-policy/preview');
  await ui.node('policy-form').fire('input'); await ui.node('confirm').fire('click');
  assert.equal(ui.calls.filter(call=>call.method==='PUT').length,1);
});

test('admin callback returns developer before operator-only session loading',async()=>{
  const source=await readFile(new URL('../../src/assets/nakwol-connect-admin.js.txt',import.meta.url),'utf8');
  const start=source.indexOf('state.user = await auth.bootstrap()');
  const marker=source.indexOf("const developerReturn = sessionStorage.getItem('nakwol.developer.return')");
  const load=source.indexOf('await loadSession()',start);
  assert.ok(start>=0 && marker>start && marker<load);
  assert.equal(source.indexOf('const developerReturn',marker+1),-1);
});
