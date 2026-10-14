import test from 'node:test';
import assert from 'node:assert/strict';
import { loginPage } from '../src/server/login.mjs';

for (const path of ['/?deck=123#detail', '/build/100?user=1#unit']) {
  test(`login preserves original URL ${path} across OAuth callback`, async () => {
    const storage = new Map();
    const sessionStorage = { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
    const elements = Object.fromEntries(['login-progress','status','login','retry','recovery','diagnostics-login'].map(k => [k, {}]));
    let authenticated = false, target;
    const sdk = { NakwolAuthClient: class { async bootstrap() { return authenticated ? {} : null; } getAccessToken() { return 'test'; } } };
    const source = loginPage({ clientId: 'site', authOrigin: 'https://auth.test', siteUrl: 'https://site.test/' }, 401).split('<script type="module">')[1].split('</script>')[0].replace("import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js')", 'sdk');
    const run = new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',"const navigator={userAgent:'fixture'}; const window={fetch,navigator};\n"+source);
    async function visit(path) {
      const url = new URL(path, 'https://site.test');
      await run(sdk, { origin:url.origin, pathname:url.pathname, search:url.search, hash:url.hash, replace:p=>{target=p;} }, {getElementById:k=>elements[k]}, sessionStorage, async()=>new Response(null,{status:204}));
    }
    await visit(path);
    authenticated = true;
    await visit('/?code=oauth-code&state=oauth-state');
    assert.equal(target, path);
  });
}

for (const status of [401,403]) test(`server session denial ${status} clears credentials and allows manual retry`, async () => {
  const source=loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js')",'sdk');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',"const navigator={userAgent:'fixture'}; const window={fetch,navigator};\n"+source);
  let cleared=0,denied=0,retried=0;
  const elements=Object.fromEntries(['login-progress','status','login','retry','recovery','diagnostics-login'].map(k=>[k,{}]));
  const sdk={NakwolAuthClient:class{
    async bootstrap(){return {};}
    getAccessToken(){return 'fixture';}
    clearDeniedLogin(error){assert.equal(error.code,'access_denied');denied++;}
    clearLocalState(){cleared++;}
    async login(){retried++;}
  }};
  await run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace(){throw new Error('must not redirect');}},{getElementById:k=>elements[k]},{getItem(){return null;},setItem(){},removeItem(){}},async()=>new Response(null,{status}));
  assert.equal(denied,1);
  assert.equal(elements.login.disabled,false);
  await elements.login.onclick();
  assert.equal(cleared,1);
  assert.equal(retried,1);
});

for (const outcome of ['authenticated', 'anonymous', 'error']) test(`login controls wait for automatic SSO: ${outcome}`, async () => {
  const html = loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401);
  const elements = Object.fromEntries(['login-progress','status','login','retry','recovery','diagnostics-login'].map(id => [id, {hidden: new RegExp(`<[^>]+id="${id}"[^>]* hidden`).test(html)}]));
  const source = html.split('<script type="module">')[1].split('</script>')[0].replace("import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js')",'sdk');
  let resolveUser, rejectUser;
  const pending = new Promise((resolve,reject) => {resolveUser=resolve;rejectUser=reject;});
  const sdk = {NakwolAuthClient:class {bootstrap(){return pending;} getAccessToken(){return 'fixture';}}};
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',"const navigator={userAgent:'fixture'}; const window={fetch,navigator};\n"+source);
  let target;
  const completed = run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace:p=>{target=p;}},{getElementById:id=>elements[id]},{getItem(){return null;},setItem(){},removeItem(){}},async()=>new Response(null,{status:204}));
  assert.equal(elements.login.hidden,true);
  assert.equal(elements.retry.hidden,true);
  if(outcome==='error') rejectUser(new Error('fixture failure'));
  else resolveUser(outcome==='authenticated'?{}:null);
  await completed;
  assert.equal(elements.login.hidden,outcome==='authenticated');
  assert.equal(target,outcome==='authenticated'?'/':undefined);
  if(outcome==='error') assert.equal(elements.retry.hidden,false);
});

for(const failure of ['rejected','pending'])test(`SDK ${failure} leaves both retry controls actionable without automatic OAuth`,async()=>{
  const ticket={reference:'dg_'+'a'.repeat(24),capability:'b'.repeat(43),expires_at:Date.now()+60000};
  const values=new Map([['nakwol:diagnostics:site',JSON.stringify({ticket,report:{observations:[]},at:Date.now(),acknowledgement:false})]]);
  const elements=Object.fromEntries(['login-progress','status','login','retry','recovery','diagnostics-login','diagnostics-status'].map(id=>[id,{}]));
  let imports=0,navigations=0;
  const loadSdk=()=>{imports++;return failure==='pending'?new Promise(()=>{}):Promise.reject(new Error('private credential error'));};
  const source=loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js')",'loadSdk()');
  assert.match(source,/45000/);
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('loadSdk','location','document','sessionStorage','fetch','setTimeout',"const navigator={userAgent:'fixture'};const window={fetch,navigator};\n"+source);
  await run(loadSdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',assign(){navigations++;},replace(){navigations++;}},{getElementById:id=>elements[id]},
    {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},async()=>Response.json({ok:true,reference:ticket.reference}), (fn,ms)=>setTimeout(fn,Math.min(ms,5)));
  assert.equal(imports,1);assert.equal(typeof elements['diagnostics-login'].onclick,'function');
  await elements['diagnostics-login'].onclick();assert.equal(imports,2);
  assert.match(elements['diagnostics-status'].textContent,/로그인 모듈.*다운로드/);
  assert.equal(elements['diagnostics-login'].disabled,false);
  await elements.login.onclick();assert.equal(imports,3);assert.match(elements.status.textContent,/로그인 모듈.*다시 시도/);
  assert.equal(navigations,0);assert.equal(elements.status.textContent.includes('private'),false);
});

for(const failure of ['anonymous',401,403,503,'cookie-loop'])test(`diagnostic terminal ${failure} uploads the final observed failure exactly once`,async()=>{
 const ticket={reference:'dg_'+'a'.repeat(24),capability:'b'.repeat(43),expires_at:Date.now()+60000};
 const values=new Map([['nakwol:diagnostics:site',JSON.stringify({ticket,report:{observations:[{probe:'auth_ping',outcome:'ok',duration_ms:1,http_status:200}]},at:Date.now(),acknowledgement:true})]]);
 if(failure==='cookie-loop')values.set('nakwol:server:return:site:attempts',JSON.stringify([Date.now(),Date.now()]));
 const elements=Object.fromEntries(['login-progress','status','login','retry','recovery','diagnostics-login'].map(id=>[id,{}]));
 const uploads=[];
 const fetch=async(url,options)=>{
  if(String(url).includes('/reports/')){uploads.push(JSON.parse(options.body));return Response.json({ok:true,reference:ticket.reference});}
  if(String(url).includes('/me'))return Response.json({}, {status:failure==='anonymous'?401:200});
  return new Response(null,{status:typeof failure==='number'?failure:204});
 };
 const sdk={NakwolAuthClient:class{
  constructor(settings){this.fetch=settings.fetchImpl;}
  async bootstrap(){await this.fetch('https://auth.test/me?client_id=site');return failure==='anonymous'?null:{};}
  getAccessToken(){return 'private access token';}clearDeniedLogin(){}
 }};
 const source=loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js')",'sdk');
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',"const navigator={userAgent:'fixture'};const window={fetch,navigator};\n"+source);
 await run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace(){throw new Error('terminal failure must stay on page');}},{getElementById:id=>elements[id]},
 {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetch);
 assert.equal(uploads.length,1);
 const last=uploads[0].observations.at(-1);assert.equal(last.probe,failure==='anonymous'?'me':'site_session');
 assert.equal(last.http_status,typeof failure==='number'?failure:failure==='anonymous'?401:204);
 assert.equal(JSON.stringify(uploads).includes('private access token'),false);assert.equal(JSON.stringify(uploads).includes(ticket.capability),false);
});
