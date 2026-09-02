import type { Hono } from 'hono';
import { DATA_OPS_CLIENT_ID, runDataOpsHandler } from './ops-auth.ts';
import { getOpsAccountDetail, getOpsDeckDetail, searchOpsAccounts } from './ops-store.ts';
import type { DataEnv } from './types.ts';

function decodeId(value:string):string { try { return decodeURIComponent(value); } catch { return value; } }

export async function handleOpsAccountSearch(request:Request, env:DataEnv):Promise<Response> {
  return runDataOpsHandler(request, env, async () => {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    const data = await searchOpsAccounts(env, query);
    return Response.json({ ok:true, data });
  });
}

export async function handleOpsAccountDetail(accountId:string, request:Request, env:DataEnv):Promise<Response> {
  return runDataOpsHandler(request, env, async () => {
    const data = await getOpsAccountDetail(env, decodeId(accountId));
    if (!data) return Response.json({ ok:false, error:{ code:'OPS_ACCOUNT_NOT_FOUND', message:'게임 계정을 찾을 수 없습니다.' } }, { status:404 });
    return Response.json({ ok:true, data });
  });
}

export async function handleOpsDeckDetail(accountId:string, deckId:string, request:Request, env:DataEnv):Promise<Response> {
  return runDataOpsHandler(request, env, async () => {
    const data = await getOpsDeckDetail(env, decodeId(accountId), decodeId(deckId));
    if (!data) return Response.json({ ok:false, error:{ code:'OPS_DECK_NOT_FOUND', message:'해당 계정의 덱을 찾을 수 없습니다.' } }, { status:404 });
    return Response.json({ ok:true, data });
  });
}

export function dataOpsPageHtml():string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>NAKWOL DATA OPS</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f2ea}
    *{box-sizing:border-box}body{margin:0;background:#f5f2ea;color:#172033}button,input{font:inherit}.shell{width:min(1180px,calc(100% - 30px));margin:0 auto;padding:28px 0 60px}
    .header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.brand small{color:#9a6c17;font-weight:900;letter-spacing:.12em}.brand h1{margin:5px 0 0;font-size:clamp(28px,4vw,40px)}.sub{color:#687385;line-height:1.55;margin:8px 0 0}.identity{text-align:right;font-size:13px;color:#596579}
    .panel,.notice{background:#fff;border:1px solid #ddd6c6;border-radius:15px;padding:18px;margin-top:14px}.notice.error{background:#fff1f1;border-color:#e7abab;color:#8f2525}[hidden]{display:none!important}
    .toolbar{display:flex;gap:9px;align-items:end;flex-wrap:wrap}.grow{flex:1;min-width:260px}.field{display:grid;gap:6px}.field label{font-size:12px;font-weight:800;color:#677487}.control{width:100%;min-height:42px;border:1px solid #cfc7b8;border-radius:10px;padding:9px 11px;background:#fff}.button{border:0;border-radius:10px;min-height:42px;padding:10px 14px;background:#a66f12;color:#fff;font-weight:800;cursor:pointer}.button.secondary{background:#fff;color:#344154;border:1px solid #cfc7b8}.button:disabled{opacity:.5;cursor:not-allowed}
    .badge{font-size:11px;font-weight:900;border-radius:999px;padding:4px 8px;background:#edf7ef;color:#276542}.muted{color:#758093;font-size:13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.card{border:1px solid #e1dbcf;border-radius:12px;padding:13px;background:#fcfbf8}.card h3{margin:0 0 8px;font-size:15px}.metric{font-size:12px;color:#687385}.metric strong{display:block;color:#172033;font-size:20px;margin-top:3px}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}th,td{padding:9px 8px;border-bottom:1px solid #ebe6db;text-align:left;vertical-align:top}th{font-size:12px;color:#758093}.link-button{border:0;background:none;color:#8a5a09;font-weight:800;padding:0;cursor:pointer;text-decoration:underline}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:350px;overflow:auto;background:#111827;color:#dbe4f0;border-radius:10px;padding:13px;font-size:12px}.section-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.section-title h2{margin:0;font-size:18px}
    @media(max-width:760px){.header{flex-direction:column}.identity{text-align:left}.toolbar{display:grid;grid-template-columns:1fr}.grow{min-width:0}.grid{grid-template-columns:1fr}.button{width:100%}table{font-size:12px}}
  </style>
</head>
<body>
<main class="shell">
  <header class="header">
    <div class="brand"><small>落月 · INTERNAL</small><h1>DATA Ops</h1><p class="sub">운영자가 사용자 DATA 저장 상태를 조회하는 read-only 도구입니다. 수정·삭제·대리 로그인 기능은 제공하지 않습니다.</p></div>
    <div id="identity" class="identity">인증 상태 확인 중</div>
  </header>

  <section id="login" class="notice" hidden>
    <strong>membership admin 로그인이 필요합니다.</strong>
    <p class="sub">전용 <code>${DATA_OPS_CLIENT_ID}</code> 앱은 admin policy만 허용합니다.</p>
    <div class="toolbar"><button id="login-button" class="button" type="button">관리자 로그인</button></div>
  </section>
  <section id="error" class="notice error" hidden aria-live="assertive"></section>

  <section id="workspace" hidden>
    <section class="panel">
      <div class="toolbar">
        <div class="field grow"><label for="query">게임 계정 검색</label><input id="query" class="control" autocomplete="off" placeholder="gac_* / DATA user ID / 닉네임 / 서버 코드"></div>
        <button id="search-button" class="button" type="button">검색</button>
        <button id="logout-button" class="button secondary" type="button">로그아웃</button>
      </div>
      <p class="muted">최대 50건을 표시합니다. 모든 결과는 production D1의 현재 read 결과입니다.</p>
      <div id="results"></div>
    </section>

    <section id="account-panel" class="panel" hidden>
      <div class="section-title"><h2 id="account-title">Account detail</h2><span class="badge">READ ONLY</span></div>
      <div id="account-summary" class="grid"></div>
      <div id="account-content"></div>
    </section>

    <section id="deck-panel" class="panel" hidden>
      <div class="section-title"><h2 id="deck-title">Deck detail</h2><span class="badge">READ ONLY</span></div>
      <div id="deck-content"></div>
    </section>

    <section id="raw-panel" class="panel" hidden>
      <div class="section-title"><h2>Raw JSON</h2><span class="muted">safe fields only</span></div>
      <pre id="raw">-</pre>
    </section>
  </section>
</main>
<script type="module">
  import { NakwolAuthClient } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.2.0/nakwol-auth-web.js';
  const CLIENT_ID = '${DATA_OPS_CLIENT_ID}';
  const auth = new NakwolAuthClient({ clientId:CLIENT_ID, redirectUri:location.origin + '/ops' });
  const identity=document.querySelector('#identity'),login=document.querySelector('#login'),workspace=document.querySelector('#workspace'),error=document.querySelector('#error');
  const query=document.querySelector('#query'),results=document.querySelector('#results'),accountPanel=document.querySelector('#account-panel'),accountTitle=document.querySelector('#account-title'),accountSummary=document.querySelector('#account-summary'),accountContent=document.querySelector('#account-content');
  const deckPanel=document.querySelector('#deck-panel'),deckTitle=document.querySelector('#deck-title'),deckContent=document.querySelector('#deck-content'),rawPanel=document.querySelector('#raw-panel'),raw=document.querySelector('#raw');

  function clearError(){error.hidden=true;error.textContent='';}
  function showError(value){error.textContent=value instanceof Error?value.message:String(value||'DATA Ops 오류');error.hidden=false;}
  function cell(text){const td=document.createElement('td');td.textContent=text==null?'':String(text);return td;}
  function heading(text){const h=document.createElement('h3');h.textContent=text;h.style.margin='18px 0 5px';return h;}
  function table(headers,rows){const t=document.createElement('table');const thead=document.createElement('thead'),hr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.textContent=h;hr.appendChild(th);}thead.appendChild(hr);t.appendChild(thead);const body=document.createElement('tbody');for(const row of rows)body.appendChild(row);t.appendChild(body);return t;}
  function setRaw(value){raw.textContent=JSON.stringify(value,null,2);rawPanel.hidden=false;}
  function fmtTime(value){return value?new Date(Number(value)).toLocaleString('ko-KR'):'-';}

  async function opsRequest(path){
    const token=auth.getAccessToken();if(!token)throw new Error('DATA_OPS_AUTH_REQUIRED');
    const response=await fetch(path,{headers:{Authorization:'Bearer '+token,'X-NAKWOL-CLIENT-ID':CLIENT_ID,'Cache-Control':'no-cache'}});
    const payload=await response.json().catch(()=>null);
    if(!response.ok||payload?.ok!==true)throw new Error((payload?.error?.code||('HTTP_'+response.status))+': '+(payload?.error?.message||'DATA Ops 조회 실패'));
    return payload.data;
  }

  async function searchAccounts(){
    clearError();results.replaceChildren();accountPanel.hidden=true;deckPanel.hidden=true;rawPanel.hidden=true;
    const q=query.value.trim();if(!q){results.appendChild(document.createTextNode('검색어를 입력하세요.'));return;}
    const rows=await opsRequest('/internal/ops/accounts?q='+encodeURIComponent(q));
    if(!rows.length){results.appendChild(document.createTextNode('검색 결과가 없습니다.'));return;}
    const bodyRows=rows.map((item)=>{const tr=document.createElement('tr');tr.append(cell(item.id),cell(item.nickname),cell(item.server_code),cell(item.is_primary?'기본':'-'),cell(fmtTime(item.updated_at)));const action=cell('');const btn=document.createElement('button');btn.type='button';btn.className='link-button';btn.textContent='조회';btn.onclick=()=>loadAccount(item.id).catch(showError);action.appendChild(btn);tr.appendChild(action);return tr;});
    results.appendChild(table(['Account ID','닉네임','서버','Primary','Updated',''],bodyRows));
  }

  function metric(label,value){const card=document.createElement('div');card.className='card';const l=document.createElement('div');l.className='metric';l.textContent=label;const strong=document.createElement('strong');strong.textContent=String(value);l.appendChild(strong);card.appendChild(l);return card;}
  function simpleRows(items,columns){return items.map((item)=>{const tr=document.createElement('tr');for(const key of columns)tr.append(cell(item[key]));return tr;});}

  async function loadAccount(accountId){
    clearError();const data=await opsRequest('/internal/ops/accounts/'+encodeURIComponent(accountId));setRaw(data.raw);
    accountPanel.hidden=false;deckPanel.hidden=true;accountTitle.textContent='Account · '+data.account.nickname+' · '+data.account.id;accountSummary.replaceChildren();
    accountSummary.append(metric('DATA user',data.account.user_id),metric('서버',data.account.server_code),metric('장수',data.generals.length),metric('전법',data.tactics.length),metric('장비',data.equipment.length),metric('Live decks',data.decks.length),metric('Snapshots',data.snapshot_summary.count),metric('Updated',fmtTime(data.account.updated_at)));
    accountContent.replaceChildren();
    accountContent.append(heading('Owned generals'),table(['ID','이름','돌파','승급','즐겨찾기','메모'],simpleRows(data.generals,['general_id','name','breakthrough','promotion','favorite','note'])));
    accountContent.append(heading('Owned tactics'),table(['ID','이름','돌파','즐겨찾기','메모'],simpleRows(data.tactics,['tactic_id','name','breakthrough','favorite','note'])));
    accountContent.append(heading('Equipment instances'),table(['ID','템플릿','타입','별칭','잠금','즐겨찾기'],simpleRows(data.equipment,['id','template_name','type','nickname','locked','favorite'])));
    const deckRows=data.decks.map((item)=>{const tr=document.createElement('tr');tr.append(cell(item.id),cell(item.name),cell(item.status),cell(item.visibility),cell(item.general_count),cell(item.tactic_count),cell(item.equipment_count));const action=cell('');const btn=document.createElement('button');btn.type='button';btn.className='link-button';btn.textContent='편성 조회';btn.onclick=()=>loadDeck(accountId,item.id).catch(showError);action.appendChild(btn);tr.appendChild(action);return tr;});
    accountContent.append(heading('Live decks'),table(['ID','이름','상태','공개','장수','전법','장비',''],deckRows));
    accountPanel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function loadDeck(accountId,deckId){
    clearError();const data=await opsRequest('/internal/ops/accounts/'+encodeURIComponent(accountId)+'/decks/'+encodeURIComponent(deckId));setRaw(data.raw);
    deckPanel.hidden=false;deckTitle.textContent='Deck · '+data.deck.name+' · '+data.deck.id;deckContent.replaceChildren();
    const meta=document.createElement('p');meta.className='muted';meta.textContent='status '+data.deck.status+' · visibility '+data.deck.visibility+' · snapshots '+data.snapshot_summary.count+' · updated '+fmtTime(data.deck.updated_at);deckContent.appendChild(meta);
    const rows=[];for(const general of data.generals){const tr=document.createElement('tr');tr.append(cell(general.position),cell(general.general_name+' · '+general.general_id),cell(general.tactics.map((t)=>t.slot+': '+t.tactic_name).join(' / ')),cell(general.weapon?general.weapon.name+' · '+general.weapon.id:'-'),cell(general.mount?general.mount.name+' · '+general.mount.id:'-'));rows.push(tr);}deckContent.appendChild(table(['위치','장수','전법','무기','탈것'],rows));deckPanel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  document.querySelector('#search-button').onclick=()=>searchAccounts().catch(showError);
  query.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();searchAccounts().catch(showError);}});
  document.querySelector('#login-button').onclick=()=>auth.login();
  document.querySelector('#logout-button').onclick=async()=>{await auth.logout();location.reload();};

  try{
    const user=await auth.bootstrap();
    if(!user){identity.textContent='로그인하지 않음';login.hidden=false;}
    else{identity.textContent=(user.display_name||user.id)+' · membership admin';workspace.hidden=false;}
  }catch(e){identity.textContent='접근 거부';login.hidden=false;showError(e);}
</script>
</body>
</html>`;
}

export function registerDataOpsRoutes(app:Hono<{ Bindings:DataEnv }>):void {
  app.get('/ops', (c) => c.html(dataOpsPageHtml()));
  app.get('/internal/ops/accounts', (c) => handleOpsAccountSearch(c.req.raw, c.env));
  app.get('/internal/ops/accounts/:accountId', (c) => handleOpsAccountDetail(c.req.param('accountId'), c.req.raw, c.env));
  app.get('/internal/ops/accounts/:accountId/decks/:deckId', (c) => handleOpsDeckDetail(c.req.param('accountId'), c.req.param('deckId'), c.req.raw, c.env));
}