import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MY_DATA_OWNED_FIRST_SCRIPT, myDataOwnedFirstPageHtml } from '../src/my-data-owned-first.ts';

const root = (path:string) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('My Data hardened route defaults deck composition to owned assets with an explicit research mode', async () => {
  const page = myDataOwnedFirstPageHtml();
  const index = await root('services/data/src/index.ts');
  const persistence = await root('services/data/src/my-data-persistence.ts');

  assert.match(index, /registerMyDataRoutes\s*}\s*from '\.\/my-data-persistence'/);
  assert.ok(persistence.includes("import { myDataOwnedFirstPageHtml } from './my-data-owned-first.ts';"));
  assert.match(page, /id="composition-mode-owned"[^>]*aria-pressed="true"[^>]*>내 보유만</);
  assert.match(page, /id="composition-mode-research"[^>]*>전체 Registry · 연구용</);
  assert.match(page, /id="composition-owned-warning"/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT, /let compositionMode = 'owned'/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT, /compositionMode = 'owned';[\s\S]*compositionDraft = compositionDraftFromDeck/);
});

test('owned mode exposes only owned generals and tactics while research mode labels unowned Registry rows', () => {
  const listeners:Record<string,Function> = {};
  const button = (id:string) => ({ id, className:'', attrs:{} as Record<string,string>, setAttribute(k:string,v:string){this.attrs[k]=v;}, addEventListener(type:string,fn:Function){listeners[id+':'+type]=fn;} });
  const nodes:Record<string,any> = {
    '#composition-mode-owned': button('owned'),
    '#composition-mode-research': button('research'),
    '#composition-owned-warning': { hidden:true, textContent:'' },
  };
  const context:any = {
    document:{ querySelector:(selector:string)=>nodes[selector] },
    owned:{
      generals:[{general_id:'g:owned',name:'보유장수'}],
      tactics:[{tactic_id:'t:owned',name:'보유전법'}],
      equipment:[], decks:[],
    },
    registry:{
      generals:[{id:'g:owned',name:'보유장수',enabled:1},{id:'g:other',name:'연구장수',enabled:1}],
      tactics:[{id:'t:owned',name:'보유전법',enabled:1},{id:'t:other',name:'연구전법',enabled:1}],
    },
    ui:{ compositionSlots:{ querySelectorAll:()=>[], replaceChildren(){} }, compositionPanel:{}, compositionTitle:{} },
    canonicalTactics:()=>[{id:'t:owned',name:'보유전법'},{id:'t:other',name:'연구전법'}],
    closeComposition:()=>{},
    openDeckComposition:async()=>{},
    data:()=>({}), ensureGeneralRegistry:async()=>{}, ensureTacticRegistry:async()=>{},
    element:()=>({dataset:{},appendChild(){},append(){}}), compositionSelect:()=>({addEventListener(){},options:[],value:''}), field:()=>({}),
    editingDeckId:'', activeAccountId:'',
    Set, Map, Array, Number, String, Boolean,
  };
  vm.createContext(context);
  vm.runInContext(MY_DATA_OWNED_FIRST_SCRIPT, context);

  assert.equal(JSON.stringify(vm.runInContext("generalPairsForMode('')", context)), JSON.stringify([['g:owned','보유장수']]));
  assert.equal(JSON.stringify(vm.runInContext("tacticPairsForMode('')", context)), JSON.stringify([['t:owned','보유전법']]));

  vm.runInContext("compositionMode = 'research'", context);
  const researchGenerals = Array.from(vm.runInContext("generalPairsForMode('')", context)) as any[];
  const researchTactics = Array.from(vm.runInContext("tacticPairsForMode('')", context)) as any[];
  assert.equal(researchGenerals.length,2);
  assert.equal(researchTactics.length,2);
  assert.match(String(researchGenerals[1][1]),/미등록 · 연구용/);
  assert.match(String(researchTactics[1][1]),/미등록 · 연구용/);
});

test('owned mode preserves an existing unowned selection instead of silently dropping it', () => {
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT, /appendCurrentPair\(pairs, currentId, registryGeneralName\(currentId\) \+ ' · 미등록 · 현재 편성'\)/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT, /appendCurrentPair\(pairs, currentId, registryTacticName\(currentId\) \+ ' · 미등록 · 현재 편성'\)/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT, /현재 편성에 미등록 장수\/전법이 포함되어 있습니다/);
});

test('deck editor disables already-selected general and equipment options in other slots', () => {
  function makeSelect(value:string, values:string[]) {
    return { value, options:values.map((item)=>({value:item,disabled:false})) };
  }
  const g1=makeSelect('g:1',['','g:1','g:2']);
  const g2=makeSelect('g:2',['','g:1','g:2']);
  const w1=makeSelect('eqp:w1',['','eqp:w1','eqp:w2']);
  const w2=makeSelect('eqp:w2',['','eqp:w1','eqp:w2']);
  const nodes:Record<string,any> = {
    '#composition-mode-owned': {className:'',setAttribute(){},addEventListener(){}},
    '#composition-mode-research': {className:'',setAttribute(){},addEventListener(){}},
    '#composition-owned-warning': {hidden:true,textContent:''},
  };
  const context:any = {
    document:{querySelector:(selector:string)=>nodes[selector]},
    owned:{generals:[],tactics:[],equipment:[],decks:[]}, registry:{generals:[],tactics:[]},
    ui:{compositionSlots:{querySelectorAll:(selector:string)=>selector==='.general-select'?[g1,g2]:selector==='.weapon-instance, .mount-instance'?[w1,w2]:[],replaceChildren(){}},compositionPanel:{},compositionTitle:{}},
    canonicalTactics:()=>[], closeComposition:()=>{}, openDeckComposition:async()=>{}, data:()=>({}), ensureGeneralRegistry:async()=>{}, ensureTacticRegistry:async()=>{},
    element:()=>({dataset:{},appendChild(){},append(){}}), compositionSelect:()=>({addEventListener(){},options:[],value:''}), field:()=>({}), editingDeckId:'',activeAccountId:'', Set,Map,Array,Number,String,Boolean,
  };
  vm.createContext(context); vm.runInContext(MY_DATA_OWNED_FIRST_SCRIPT,context); vm.runInContext('refreshCompositionDuplicateGuards()',context);
  assert.equal(g1.options.find((item)=>item.value==='g:2')?.disabled,true);
  assert.equal(g2.options.find((item)=>item.value==='g:1')?.disabled,true);
  assert.equal(w1.options.find((item)=>item.value==='eqp:w2')?.disabled,true);
  assert.equal(w2.options.find((item)=>item.value==='eqp:w1')?.disabled,true);
  assert.equal(g1.options.find((item)=>item.value==='g:1')?.disabled,false);
  assert.equal(w1.options.find((item)=>item.value==='eqp:w1')?.disabled,false);
});

test('owned-first layer does not introduce raw token or low-level DATA access', () => {
  assert.doesNotMatch(MY_DATA_OWNED_FIRST_SCRIPT,/getAccessToken|Authorization|\.request\(/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT,/api\.decks\.get\(/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT,/canonicalTactics\(\)/);
  assert.match(MY_DATA_OWNED_FIRST_SCRIPT,/owned\.equipment/);
});