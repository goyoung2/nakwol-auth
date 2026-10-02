import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPresentation, parsePresentation } from '../src/shared/presentation-schema.mjs';
import { serveProtected } from '../src/server/gate.mjs';
import { loginPage,presentationBoot } from '../src/server/login.mjs';
import {applyWidgetPresentation} from '../src/shared/presentation-renderer.mjs';
import vm from 'node:vm';

test('inline and sticky widgets can use the SDK mount slot itself without appending themselves',()=>{
 const oldDocument=globalThis.document;
 const element={classList:{add(){},toggle(){}},dataset:{},style:{setProperty(){},removeProperty(){}},contains(other){return other===this;},append(other){assert.notEqual(other,this,'cannot append mount slot to itself');}};
 globalThis.document={getElementById(){return true;},querySelector(){return element;}};
 try{for(const placement of ['inline','sticky'])for(const visibility of ['visible','hidden']){const p=defaultPresentation();p.widget.placement=placement;p.widget.visibility=visibility;applyWidgetPresentation(element,p);assert.equal(element.hidden,visibility==='hidden');}}finally{globalThis.document=oldDocument;}
});

test('system widget keeps configured base tokens so the light media rule can be reversed',()=>{
 const oldDocument=globalThis.document,oldMedia=globalThis.matchMedia,values=new Map();
 globalThis.document={getElementById(){return true;},querySelector(){return null;}};globalThis.matchMedia=()=>({matches:true});
 const element={classList:{add(){},toggle(){}},dataset:{},style:{setProperty(k,v){values.set(k,v);},removeProperty(){}}};
 try{const p=defaultPresentation();p.theme.mode='system';applyWidgetPresentation(element,p);assert.equal(values.get('--nakwol-auth-bg'),p.theme.surface);assert.equal(values.get('--nakwol-auth-text'),p.theme.text);}finally{globalThis.document=oldDocument;globalThis.matchMedia=oldMedia;}
});

test('both official login flows preserve the runtime cookie-blocked reason for the shared renderer',async()=>{
 const settings={clientId:'a',authOrigin:'https://auth.test',siteUrl:'https://a.test/'};
 let shown;const root={dataset:{}},status={textContent:''},login={},retry={},recovery={};
 const document={getElementById(id){return ({'nakwol-brand':root,status,login,retry,recovery,fallback:{}})[id];}};
 const renderer={mountPresentationScreen(_root,options){shown=options;return {setState(state,reason){shown={...shown,state,reason};},setPresentation(){}};},loadPresentation:async()=>defaultPresentation()};
 const SDK={NakwolAuthClient:class{async bootstrap(){return {id:'user'};}getAccessToken(){return 'fixture';}}};
 const html=loginPage(settings,401),source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replaceAll('import(','fixtureImport(');
 const context=vm.createContext({document,location:{pathname:'/',search:'',hash:'',origin:'https://a.test',reload(){},replace(){throw new Error('cookie loop must stop');}},sessionStorage:{getItem:key=>key.endsWith(':attempts')?JSON.stringify([Date.now(),Date.now()]):null,removeItem(){},setItem(){}},fixtureImport:async url=>String(url).includes('renderer')?renderer:SDK,fetch:async()=>new Response(null,{status:204}),URL,URLSearchParams,JSON,Date,AbortSignal});
 await vm.runInContext('(async()=>{'+source+'})()',context);
 assert.equal(shown.reason,'cookie-blocked');assert.equal(shown.state,'unavailable');
 const env={NAKWOL_SESSION_SECRET:'x'.repeat(40),NAKWOL_SITE_CREDENTIAL:'fixture',ASSETS:{fetch(){throw new Error('private');}}};
 const response=await serveProtected(new Request('https://a.test/',{headers:{Accept:'text/html'}}),env,{...settings,sessionMode:'server-refresh-v1',accessPolicy:'member'});
 const page=await response.text(),script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(script,{document:{getElementById(){return root;},querySelector(){return status;}},sessionStorage:{getItem:()=>JSON.stringify([Date.now(),Date.now()]),setItem(){}},location:{pathname:'/',search:'',hash:''},JSON,Date});
 assert.equal(root.dataset.reason,'cookie-blocked');assert.equal(root.dataset.state,'unavailable');assert.ok(page.includes('root.dataset.reason'));
});

test('both gate login renderers escape embedded configuration before inline script parsing',()=>{
 const settings={clientId:'</script><script>alert(1)</script>',authOrigin:'https://auth.test',siteUrl:'https://a.test/'};
 for(const html of [loginPage(settings,401),presentationBoot(settings,'login','/')])assert.ok(!html.includes(settings.clientId));
});

test('presentation schema covers supported widget/theme/state fixtures and rejects executable configuration', () => {
  for (const visibility of ['visible','hidden']) for (const placement of ['inline','fixed','sticky']) for (const variant of ['button','compact','menu']) for (const mode of ['light','dark','system']) {
    const config=defaultPresentation();config.widget={...config.widget,visibility,placement,variant};config.theme.mode=mode;
    assert.deepEqual(parsePresentation(config),config);
  }
  for(const patch of [{schemaVersion:2},{html:'<script>'},{support:{url:'javascript:alert(1)',label:'help'}},{theme:{...defaultPresentation().theme,text:'#000000',background:'#000000'}},{screens:{...defaultPresentation().screens,connected:{title:'ok'}}}]) assert.throws(()=>parsePresentation({...defaultPresentation(),...patch}));
  const config=defaultPresentation();config.screens.login.title='<img onerror=alert(1)>';
  assert.equal(parsePresentation(config).screens.login.title,config.screens.login.title);
});

test('hidden presentation cannot change anonymous GET HEAD Range protection or fetch settings per asset', async () => {
  let served=0;const old=globalThis.fetch;globalThis.fetch=()=>{throw new Error('anonymous assets must not fetch AUTH/config');};
  try {
    const env={NAKWOL_SESSION_SECRET:'x'.repeat(40),NAKWOL_SITE_CREDENTIAL:'fixture',ASSETS:{fetch(){served++;return new Response('PRIVATE');}}};
    const settings={clientId:'a',siteUrl:'https://a.test',authOrigin:'https://auth.test',accessPolicy:'member',sessionMode:'server-refresh-v1',presentation:defaultPresentation()};settings.presentation.widget.visibility='hidden';
    for(const path of ['/','/image.webp','/data.json','/app.js','/app.css','/font.woff2','/download.zip']) for(const mode of ['GET','HEAD','Range']) {
      const response=await serveProtected(new Request('https://a.test'+path,{method:mode==='HEAD'?'HEAD':'GET',headers:mode==='Range'?{Range:'bytes=0-1'}:{}}),env,settings);
      assert.equal(response.status,401);assert.ok(!(await response.text()).includes('PRIVATE'));
    }
    assert.equal(served,0);
  } finally {globalThis.fetch=old;}
});
