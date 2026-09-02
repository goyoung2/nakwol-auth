import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MY_DATA_PERSISTENCE_SCRIPT, myDataPersistencePageHtml } from '../src/my-data-persistence.ts';

const root = (path:string) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

function baseApi(overrides:Record<string,unknown>={}) {
  const api:any = {
    accounts:{ list:async()=>({data:[]}), create:async()=>({data:{id:'gac_1'}}) },
    roster:{
      generals:{ list:async()=>({data:[]}), upsert:async()=>({ok:true}), remove:async()=>({ok:true}) },
      tactics:{ list:async()=>({data:[]}), upsert:async()=>({ok:true}), remove:async()=>({ok:true}) },
    },
    equipment:{ list:async()=>({data:[]}), create:async()=>({data:{id:'eqp_1'}}), update:async()=>({ok:true}), remove:async()=>({ok:true}) },
    decks:{ list:async()=>({data:[]}), get:async()=>({data:null}), create:async()=>({data:{id:'dek_1'}}), update:async()=>({ok:true}), replaceComposition:async()=>({ok:true}), remove:async()=>({ok:true}) },
    registry:{}, snapshots:{},
  };
  for (const [key,value] of Object.entries(overrides)) api[key]=value;
  return api;
}

function makeContext(api:any) {
  const status:any = { hidden:true, className:'notice', textContent:'' };
  const messages:string[]=[];
  const context:any = {
    document:{ querySelector:(selector:string)=>selector==='#persistence-status'?status:null },
    data:()=>api,
    showMessage:(message:string)=>messages.push(message),
    Intl, Date, Error, Object, Array, Number, String, Boolean, JSON, Promise,
  };
  vm.createContext(context);
  vm.runInContext(MY_DATA_PERSISTENCE_SCRIPT,context);
  return {context,status,messages};
}

test('My Data route serves the persistence-confirmed layer and visible verification status', async()=>{
  const page=myDataPersistencePageHtml();
  const index=await root('services/data/src/index.ts');
  assert.match(index,/registerMyDataRoutes\s*}\s*from '\.\/my-data-persistence'/);
  assert.match(page,/id="persistence-status"/);
  assert.match(page,/내 보유만/);
  assert.match(page,/전체 Registry · 연구용/);
  assert.match(MY_DATA_PERSISTENCE_SCRIPT,/저장 요청은 성공했지만 재확인하지 못했습니다/);
});

test('successful general write is re-read before My Data reports 저장 확인됨',async()=>{
  let stored:any=null; let writes=0; let reads=0;
  const api=baseApi();
  api.roster.generals={
    upsert:async(_accountId:string,generalId:string,input:any)=>{writes++;stored={general_id:generalId,...input};return {ok:true};},
    list:async()=>{reads++;return {data:stored?[stored]:[]};},
    remove:async()=>({ok:true}),
  };
  const {context,status,messages}=makeContext(api);
  await vm.runInContext("data().roster.generals.upsert('gac_1','g:1',{breakthrough:5,promotion:3,favorite:true,note:'주력'})",context);
  assert.equal(writes,1); assert.equal(reads,1);
  assert.match(status.textContent,/저장 확인됨/);
  vm.runInContext("showMessage('장수 정보를 저장했습니다.')",context);
  assert.equal(messages.length,1);
  assert.match(messages[0],/^저장 확인됨/);
  assert.match(messages[0],/장수 정보를 저장했습니다/);
});

test('write success plus mismatched authoritative read is reported as verification uncertainty',async()=>{
  let writes=0;
  const api=baseApi();
  api.roster.generals={
    upsert:async()=>{writes++;return {ok:true};},
    list:async()=>({data:[{general_id:'g:1',breakthrough:0,promotion:0,favorite:false,note:null}]}),
    remove:async()=>({ok:true}),
  };
  const {context,status,messages}=makeContext(api);
  let caught:any=null;
  try { await vm.runInContext("data().roster.generals.upsert('gac_1','g:1',{breakthrough:5,promotion:3,favorite:true,note:'주력'})",context); }
  catch(error){ caught=error; }
  assert.equal(writes,1);
  assert.equal(caught?.code,'PERSISTENCE_VERIFY_FAILED');
  assert.match(String(caught?.message),/저장 요청은 성공했지만 재확인하지 못했습니다/);
  assert.match(status.textContent,/저장 요청 성공 · 재확인 실패/);
  assert.equal(messages.length,0);
});

test('deck composition is normalized and compared against authoritative deck detail',async()=>{
  let writes=0; let reads=0;
  const expected={generals:[{
    position:1,general_id:'g:1',weapon_instance_id:'eqp_w',mount_instance_id:'eqp_m',
    tactics:[{slot:2,tactic_id:'t:2'},{slot:1,tactic_id:'t:1'}],
  }]};
  const api=baseApi();
  api.decks={
    ...api.decks,
    replaceComposition:async()=>{writes++;return {ok:true};},
    get:async()=>{reads++;return {data:{generals:[{
      position:1,general_id:'g:1',weapon:{id:'eqp_w'},mount:{id:'eqp_m'},
      tactics:[{slot:1,tactic_id:'t:1'},{slot:2,tactic_id:'t:2'}],
    }]}};},
  };
  const {context,status}=makeContext(api); context.expected=expected;
  await vm.runInContext("data().decks.replaceComposition('gac_1','dek_1',expected)",context);
  assert.equal(writes,1); assert.equal(reads,1);
  assert.match(status.textContent,/저장 확인됨/);
});

test('delete is confirmed only after the entity is absent from a fresh list',async()=>{
  let items=[{id:'eqp_1',nickname:'검'}]; let deletes=0; let reads=0;
  const api=baseApi();
  api.equipment={
    ...api.equipment,
    remove:async(_accountId:string,id:string)=>{deletes++;items=items.filter((row)=>row.id!==id);return {ok:true};},
    list:async()=>{reads++;return {data:items};},
  };
  const {context,status}=makeContext(api);
  await vm.runInContext("data().equipment.remove('gac_1','eqp_1')",context);
  assert.equal(deletes,1); assert.equal(reads,1);
  assert.match(status.textContent,/삭제 확인됨/);
});

test('persistence layer stays on the high-level Data SDK and never handles token material',()=>{
  assert.doesNotMatch(MY_DATA_PERSISTENCE_SCRIPT,/Authorization|Bearer|getAccessToken|sessionStorage|\.request\(/);
  assert.match(MY_DATA_PERSISTENCE_SCRIPT,/api\.roster\.generals\.list/);
  assert.match(MY_DATA_PERSISTENCE_SCRIPT,/api\.equipment\.list/);
  assert.match(MY_DATA_PERSISTENCE_SCRIPT,/api\.decks\.get/);
  assert.match(MY_DATA_PERSISTENCE_SCRIPT,/api\.decks\.list/);
});
