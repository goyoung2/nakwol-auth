import { defaultPresentation, parsePresentation } from './presentation-schema.mjs';
const documents=new Map();
const labels={login:'낙월 로그인이 필요합니다',checking:'접속 확인 중…',denied:'접근 권한 없음',unavailable:'인증 서버에 연결할 수 없습니다'};
const descriptions={login:'Discord로 로그인하면 이 서비스의 접근 조건을 확인합니다.',checking:'',denied:'접근 조건이 확인되지 않았습니다. 역할을 받았다면 다시 로그인하여 확인하세요.',unavailable:'잠시 후 다시 시도하세요. 접속 문제 해결에서 계정 상태도 확인할 수 있습니다.'};
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
export async function loadPresentation(authOrigin,clientId) {
  const url=new URL('/public/v1/apps/'+encodeURIComponent(clientId)+'/presentation',authOrigin).href;
  const existing=documents.get(url);if(existing?.until>Date.now())return existing.promise;
  if(documents.size>=32)documents.delete(documents.keys().next().value);
  const promise=(async()=>{try{const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error('HTTP');const reader=r.body?.getReader();if(!reader)throw new Error('body');let size=0,parts=[];try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>16384){await reader.cancel();throw new Error('size');}parts.push(x.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return parsePresentation(JSON.parse(new TextDecoder().decode(bytes)));}catch{console.warn('[NAKWOL] presentation unavailable or unsupported; using built-in theme');return defaultPresentation();}})();
  documents.set(url,{promise,until:Date.now()+60000});return promise;
}
export function safePresentation(value){try{return parsePresentation(value);}catch{return defaultPresentation();}}
export function themeTokens(value) {
  const p=safePresentation(value),light=p.theme.mode==='system'&&matchMedia('(prefers-color-scheme: light)').matches;
  return light?{...p.theme,background:'#f6f3eb',surface:'#ffffff',text:'#182235',muted:'#475569'}:p.theme;
}
function styles(){
  if(document.getElementById('nakwol-presentation-style'))return;
  const style=node('style');style.id='nakwol-presentation-style';style.textContent=`
  .nakwol-screen{box-sizing:border-box;min-height:100%;display:grid;place-items:center;padding:24px;padding-top:max(24px,env(safe-area-inset-top));padding-bottom:max(24px,env(safe-area-inset-bottom));font-family:system-ui,sans-serif;background:var(--np-background);color:var(--np-text)}
  .nakwol-screen [hidden]{display:none!important}.nakwol-screen__card{box-sizing:border-box;width:min(480px,100%);padding:24px;background:var(--np-surface);border:1px solid var(--np-muted);border-radius:var(--np-radius);overflow-wrap:anywhere;position:relative}
  .nakwol-screen__background{width:100%;height:120px;object-fit:cover;display:block;border-radius:var(--np-radius);margin-bottom:16px}.nakwol-screen__logo{width:64px;height:64px;object-fit:contain;margin-bottom:16px}.nakwol-screen h1{font-size:calc(var(--np-size)*1.25);line-height:1.5;margin:0 0 12px}.nakwol-screen h2{font-size:var(--np-size);line-height:1.5;margin:12px 0}.nakwol-screen p{line-height:1.6;font-size:calc(var(--np-size)*.875);color:var(--np-muted)}.nakwol-screen__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.nakwol-screen button,.nakwol-screen a{box-sizing:border-box;display:inline-flex;justify-content:center;align-items:center;min-height:44px;padding:12px 16px;border:1px solid var(--np-muted);border-radius:var(--np-radius);font:inherit;font-size:calc(var(--np-size)*.875);cursor:pointer;color:var(--np-text);background:var(--np-surface);text-decoration:none}.nakwol-screen button:first-child{background:var(--np-accent);color:#fff;border-color:transparent}.nakwol-screen :focus-visible{outline:3px solid var(--np-accent);outline-offset:4px}.nakwol-screen__brand{font-size:14px;font-weight:700;color:var(--np-muted)}
  .nakwol-presentation-widget[hidden]{display:none!important}.nakwol-hide-name .nakwol-identity__name{display:none}.nakwol-presentation-widget{max-width:calc(100vw - 32px);box-sizing:border-box}.nakwol-presentation-widget button,.nakwol-presentation-widget a{min-height:44px!important}.nakwol-presentation-widget[data-placement="inline"]{display:flex;margin:16px 0}.nakwol-presentation-widget[data-placement="sticky"]{position:sticky;display:flex;min-height:44px;z-index:100}.nakwol-presentation-widget[data-placement="fixed"]{position:fixed;z-index:2147483000}.nakwol-presentation-widget[data-position^="bottom"] .nakwol-identity__menu{top:auto;bottom:calc(100% + 8px)}.nakwol-presentation-widget[data-position$="left"] .nakwol-identity__menu{right:auto;left:0}.nakwol-presentation-widget .nakwol-identity__menu{min-width:min(220px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
  .nakwol-presentation-widget .nakwol-identity__name{font-size:calc(var(--np-size)*.875)}
  @media(prefers-color-scheme:light){.nakwol-presentation-widget[data-mode="system"]{--nakwol-auth-bg:#ffffff!important;--nakwol-auth-text:#182235!important;--nakwol-auth-muted:#475569!important}}
  @media(prefers-reduced-motion:reduce){.nakwol-screen *,.nakwol-presentation-widget *{animation:none!important;transition:none!important}}
  `;document.head.append(style);
}
export function applyTheme(element,presentation){const t=themeTokens(presentation);for(const key of ['background','surface','text','muted','accent'])element.style.setProperty('--np-'+key,t[key]);element.style.setProperty('--np-radius',t.radius+'px');element.style.setProperty('--np-size',({sm:14,md:16,lg:18})[t.size]+'px');element.style.fontSize='var(--np-size)';}
export function mountPresentationScreen(container,options) {
  styles();let p=safePresentation(options.presentation),state=options.state||'checking',reason=options.reason,started=options.startedAt||Date.now(),delay,slow,destroyed=false;
  const root=node('section');root.className='nakwol-screen';root.setAttribute('aria-live','polite');root.dataset.state=state;
  const card=node('div');card.className='nakwol-screen__card';const brand=node('p'),logo=node('img'),background=node('img'),title=node('h1'),custom=node('h2'),copy=node('p'),actions=node('div');brand.className='nakwol-screen__brand';logo.className='nakwol-screen__logo';background.className='nakwol-screen__background';logo.alt='';background.alt='';logo.width=64;logo.height=64;background.width=432;background.height=120;actions.className='nakwol-screen__actions';
  const login=node('button','Discord로 로그인'),retry=node('button','다시 시도'),recovery=node('a','계정 확인·접속 문제 해결'),support=node('a');login.type='button';retry.type='button';login.addEventListener('click',()=>options.actions.login());retry.addEventListener('click',()=>options.actions.retry());
  recovery.href=new URL('/account?client_id='+encodeURIComponent(options.clientId)+'&recovery=1',options.authOrigin).href;support.rel='noopener noreferrer';support.target='_blank';
  actions.append(login,retry,recovery,support);card.append(background,logo,brand,title,custom,copy,actions);root.append(card);container.replaceChildren(root);
  const asset=id=>options.assetResolver?options.assetResolver(id):new URL('/public/v1/apps/'+encodeURIComponent(options.clientId)+'/brand/'+encodeURIComponent(id),options.authOrigin).href;
  const fallback=()=>{if(destroyed)return;p=defaultPresentation();render();};logo.addEventListener('error',fallback);background.addEventListener('error',fallback);
  function image(el,id){if(id){const url=asset(id);if(el.getAttribute('src')!==url)el.src=url;el.hidden=false;}else{el.hidden=true;el.removeAttribute('src');}}
  function render(){if(destroyed)return;const checking=state==='checking',elapsed=Date.now()-started,s=p.screens[state]||p.screens.unavailable;applyTheme(root,p);root.dataset.state=state;root.dataset.presentationVersion=String(p.version);card.style.textAlign=s.layout==='left'?'left':'center';
    card.hidden=checking&&elapsed<250;title.textContent=reason==='cookie-blocked'?'로그인 쿠키를 저장하지 못했습니다':labels[state]||labels.unavailable;brand.textContent=s.serviceName;brand.hidden=checking||!s.serviceName;custom.textContent=s.title;custom.hidden=checking||!s.title;
    copy.textContent=reason==='cookie-blocked'?'이 사이트의 쿠키를 허용한 뒤 다시 시도해 주세요.':checking?(elapsed>=8000?'확인이 지연되고 있습니다. 다시 시도하거나 계정 상태를 확인하세요.':''):(descriptions[state]+(s.copy?' '+s.copy:''));copy.hidden=!copy.textContent;
    image(logo,checking?null:s.logoAssetId);image(background,checking?null:s.backgroundAssetId);actions.hidden=checking&&elapsed<8000;login.hidden=checking||state==='unavailable';retry.hidden=state==='login';support.hidden=!p.support.url;support.textContent=p.support.label;if(p.support.url)support.href=p.support.url;
  }
  function timers(){clearTimeout(delay);clearTimeout(slow);if(state==='checking'){delay=setTimeout(render,Math.max(0,250-(Date.now()-started)));slow=setTimeout(render,Math.max(0,8000-(Date.now()-started)));}}
  const media=matchMedia('(prefers-color-scheme: light)');media.addEventListener('change',render);render();timers();
  return {element:root,setState(next,nextReason){if(!labels[next])next='unavailable';reason=nextReason;if(next!==state){state=next;started=Date.now();}render();timers();},setPresentation(value){p=safePresentation(value);render();},destroy(){destroyed=true;clearTimeout(delay);clearTimeout(slow);media.removeEventListener('change',render);root.remove();}};
}
export function applyWidgetPresentation(element,value) {
  styles();const p=safePresentation(value),w=p.widget,t=p.theme.mode==='system'?p.theme:themeTokens(p);element.classList.add('nakwol-presentation-widget');element.dataset.placement=w.placement;element.dataset.position=w.position;
  element.dataset.theme=p.theme.mode==='system'?'inherit':p.theme.mode;element.dataset.mode=p.theme.mode;element.style.setProperty('--np-size',({sm:14,md:16,lg:18})[t.size]+'px');
  for(const [key,v] of Object.entries({accent:t.accent,bg:t.surface,text:t.text,muted:t.muted,radius:t.radius+'px'}))element.style.setProperty('--nakwol-auth-'+key,v);
  for(const side of ['top','right','bottom','left'])element.style.removeProperty(side);
  element.style.position=w.placement==='inline'?'relative':w.placement;
  element.classList.toggle('nakwol-hide-name',!w.showName);
  if(w.placement!=='fixed'){const slot=document.querySelector('[data-nakwol-widget]');if(slot&&slot!==element&&!element.contains(slot))slot.append(element);else if(!slot&&element.parentElement===document.body)document.body.prepend(element);}
  if(w.placement==='fixed'){for(const side of w.position.split('-'))element.style[side]=`max(${w.margin}px, env(safe-area-inset-${side}))`;}
  else if(w.placement==='sticky')element.style.top=`max(${w.margin}px, env(safe-area-inset-top))`;
  element.hidden=w.visibility==='hidden';return p;
}
export function checkHeadlessBindings(scope=document) {
  const missing=['login','logout','recovery'].filter(action=>!scope.querySelector((action==='recovery'?'a':'button')+'[data-nakwol-action="'+action+'"]'));return {ok:missing.length===0,missing};
}
export function bindHeadless(client,scope=document) {
  const handlers=[];for(const action of ['login','logout'])for(const el of scope.querySelectorAll('[data-nakwol-action="'+action+'"]')){const handler=()=>void client[action]();el.addEventListener('click',handler);handlers.push([el,handler]);}
  for(const el of scope.querySelectorAll('[data-nakwol-action="recovery"]'))el.href=new URL('/account?client_id='+encodeURIComponent(client.clientId)+'&recovery=1',client.authOrigin).href;
  const result=checkHeadlessBindings(scope);if(!result.ok)console.warn('[NAKWOL] headless bindings missing:',result.missing.join(', '));return {...result,destroy(){for(const [el,h]of handlers)el.removeEventListener('click',h);}};
}
