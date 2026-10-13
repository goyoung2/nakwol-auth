/** Self-contained: the same function runs inline on the site and central AUTH. */
export function diagnosticRuntime(settings) {
  const key = 'nakwol:diagnostics:' + settings.clientId;
  const nativeFetch = window.fetch.bind(window);
  const report = {schema_version:1,observations:[],browser:/Firefox/i.test(window.navigator.userAgent)?'firefox':/Edg|Chrome|Chromium/i.test(window.navigator.userAgent)?'chromium':/Safari/i.test(window.navigator.userAgent)?'safari':'other',platform:/Android|iPhone|iPad|Mobile/i.test(window.navigator.userAgent)?'mobile':'desktop'};
  let ticket=null, active=null, running=false, cancelled=false, acknowledgement=false, revision=0;
  let localReference='local-'+crypto.randomUUID(), uploadStatus='아직 전송하지 않았습니다.';
  const $=id=>document.getElementById('diagnostics-'+id);
  const status=message=>{if($('status')) $('status').textContent=message;};
  const cleanObservation=o=>o && ['site_ping','auth_ping','sdk','application','token','me','site_session','page_navigation'].includes(o.probe)
    && ['ok','http_error','timeout_or_cors','cancelled','unavailable'].includes(o.outcome)
    && Number.isSafeInteger(o.duration_ms)&&o.duration_ms>=0&&o.duration_ms<=120000
    && (o.http_status===null||Number.isInteger(o.http_status)&&o.http_status>=100&&o.http_status<=599);
  const cleanTiming=t=>t===null||t&&Object.keys(t).length===4&&['dns_ms','connect_ms','tls_ms','ttfb_ms'].every(k=>t[k]===null||Number.isSafeInteger(t[k])&&t[k]>0&&t[k]<=120000);
  const sanitizeObservation=o=>({probe:o.probe,outcome:o.outcome,duration_ms:o.duration_ms,http_status:o.http_status,...(['site_ping','auth_ping'].includes(o.probe)&&cleanTiming(o.timing)?{timing:o.timing===null?null:{dns_ms:o.timing.dns_ms,connect_ms:o.timing.connect_ms,tls_ms:o.timing.tls_ms,ttfb_ms:o.timing.ttfb_ms}}:{})});
  const payload=()=>({...report,observations:report.observations.filter(cleanObservation).slice(-16).map(sanitizeObservation)});
  const save=()=>{
    try {sessionStorage.setItem(key,JSON.stringify({ticket,report:payload(),at:Date.now(),localReference,acknowledgement}));}
    catch {status('이 브라우저에서 임시 저장을 사용할 수 없습니다. 보고서를 다운로드해 주세요.');}
  };
  const restore=()=>{
    try {const saved=JSON.parse(sessionStorage.getItem(key)||'null');
      if(!saved || Date.now()-saved.at>30*60000) {sessionStorage.removeItem(key);return;}
      if(saved.ticket && /^dg_[A-Za-z0-9_-]{24}$/.test(saved.ticket.reference) && /^[A-Za-z0-9_-]{43}$/.test(saved.ticket.capability) && saved.ticket.expires_at>Date.now()) ticket={reference:saved.ticket.reference,capability:saved.ticket.capability,expires_at:saved.ticket.expires_at};
      if(Array.isArray(saved.report?.observations)) report.observations=saved.report.observations.filter(cleanObservation).slice(-16).map(sanitizeObservation);
      if(/^local-[a-f0-9-]{36}$/.test(saved.localReference)) localReference=saved.localReference;
      acknowledgement=Boolean(ticket&&saved.acknowledgement);
      uploadStatus=acknowledgement?'이전 보고서 접수를 AUTH에서 확인했습니다.':'현재 보고서의 접수를 확인하지 못했습니다. 로컬 자료가 남아 있습니다.';
    } catch {try{sessionStorage.removeItem(key);}catch{/* Storage is unavailable; keep the in-memory report usable. */}}
  };
  restore();
  const labels={site_ping:'사이트 연결',auth_ping:'AUTH 연결',sdk:'로그인 모듈',application:'앱·DB 확인',token:'인증 코드 교환',me:'접근 권한 확인',site_session:'사이트 로그인 저장',page_navigation:'현재 페이지 이동'};
  const render=()=>{
    const results=$('results'); if(results) {results.replaceChildren();
      for(const o of payload().observations) {const li=document.createElement('li');li.textContent=labels[o.probe]+' · '+({ok:'응답 확인',http_error:'HTTP 오류',timeout_or_cors:'시간 초과·CORS·네트워크 확인 불가',cancelled:'취소됨',unavailable:'설치 여부 확인 불가'}[o.outcome])+' · '+o.duration_ms+'ms'+(o.http_status?' · HTTP '+o.http_status:'');if(o.timing) {const names={dns_ms:'DNS',connect_ms:'TCP',tls_ms:'TLS',ttfb_ms:'첫 응답'};li.textContent+=' · '+Object.entries(o.timing).map(([k,v])=>names[k]+': '+(v===null?'미관측':v+'ms')).join(' / ');}results.append(li);}
    }
    if($('reference')) $('reference').textContent=acknowledgement?'접수된 진단 번호: '+ticket.reference:(ticket?'발급된 진단 번호 (현재 보고서 미접수): '+ticket.reference+' · ':'')+'로컬 보고서 번호: '+localReference;
    if($('upload')) $('upload').textContent=uploadStatus;
    for(const name of ['copy','download']) if($ (name)) $(name).disabled=!report.observations.length;
    if($('login')) $('login').disabled=running || !ticket || ticket.expires_at<=Date.now() || settings.central;
  };
  const observe=(probe,outcome,start,http_status=null,timing)=>{acknowledgement=false;revision++;uploadStatus='새 관측 자료의 접수를 아직 확인하지 못했습니다.';report.observations.push({probe,outcome,duration_ms:Math.max(0,Math.min(120000,Math.round(performance.now()-start))),http_status,...(timing===undefined?{}:{timing})});report.observations=report.observations.slice(-16);save();render();};
  async function request(url,options={},timeout=5000,json=false) {
    const controller=new AbortController(); active=controller;
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await nativeFetch(url,{...options,cache:'no-store',redirect:'error',signal:controller.signal});return json?{response,body:await response.json()}:response;}
    finally{clearTimeout(timer);if(active===controller) active=null;}
  }
  async function probe(name,url) {
    if(cancelled) return;
    status(labels[name]+' 확인 중…');
    const start=performance.now();
    try {const response=await request(url);await response.body?.cancel();
      let timing=null;
      if(['site_ping','auth_ping'].includes(name)&&typeof performance.getEntriesByName==='function') {
        await new Promise(resolve=>setTimeout(resolve,0));
        const entry=performance.getEntriesByName(url,'resource').at(-1);
        if(entry&&entry.startTime>=start-1&&entry.responseStart>0&&entry.requestStart>0) {
          const delta=(end,begin)=>end>begin&&begin>0?Math.max(1,Math.min(120000,Math.round(end-begin))):null;
          timing={dns_ms:delta(entry.domainLookupEnd,entry.domainLookupStart),connect_ms:delta(entry.secureConnectionStart||entry.connectEnd,entry.connectStart),tls_ms:delta(entry.connectEnd,entry.secureConnectionStart),ttfb_ms:delta(entry.responseStart,entry.requestStart)};
        }
      }
      observe(name,response.ok?'ok':'http_error',start,response.status,...(['site_ping','auth_ping'].includes(name)?[timing]:[]));}
    catch {observe(name,cancelled?'cancelled':'timeout_or_cors',start);}
  }
  const clientQuery='?client_id='+encodeURIComponent(settings.clientId);
  async function issue() {
    if(!settings.clientId) return false;
    try {
      const {response,body}=await request(settings.authOrigin+'/diagnostics/tickets'+clientQuery,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},4000,true);
      if(!response.ok || !/^dg_[A-Za-z0-9_-]{24}$/.test(body.reference) || !/^[A-Za-z0-9_-]{43}$/.test(body.capability)) return false;
      ticket={reference:body.reference,capability:body.capability,expires_at:body.expires_at};save();return true;
    } catch {return false;}
  }
  async function upload() {
    if(!ticket || cancelled) {uploadStatus='전송되지 않았습니다. 로컬 보고서를 복사하거나 다운로드해 주세요.';render();return false;}
    const sentRevision=revision;
    uploadStatus='보고서를 전송하는 중…';render();
    try {
      const {response,body}=await request(settings.authOrigin+'/diagnostics/reports/'+ticket.reference+clientQuery,{method:'POST',headers:{'Content-Type':'application/json','X-Nakwol-Diagnostic-Capability':ticket.capability},body:JSON.stringify(payload())},4000,true);
      if(!response.ok||body.ok!==true||body.reference!==ticket.reference) throw new Error('unacknowledged');
      acknowledgement=revision===sentRevision;uploadStatus=acknowledgement?'AUTH에서 현재 보고서 접수를 확인했습니다.':'이전 자료는 접수되었으며 새 관측 자료는 아직 미접수입니다.';save();render();return acknowledgement;
    } catch {uploadStatus='이번 전송을 확인하지 못했습니다. 로컬 보고서가 남아 있습니다.';render();return false;}
  }
  async function run() {
    if(running)return;
    running=true;cancelled=false;ticket=null;acknowledgement=false;revision++;report.observations=[];localReference='local-'+crypto.randomUUID();
    if($('start')) $('start').disabled=true; if($('cancel')) $('cancel').disabled=false;
    const total=setTimeout(()=>{cancelled=true;active?.abort();status('진단 제한 시간에 도달했습니다.');},25000);
    try {
      if(settings.sitePing) await probe('site_ping',location.origin+'/__nakwol/diagnostics/ping');
      await probe('auth_ping',settings.authOrigin+'/diagnostics/ping');
      if(!cancelled) await probe('sdk',settings.authOrigin+'/sdk/v0.3.3/nakwol-auth-web.js');
      if(!cancelled&&settings.clientId) await probe('application',settings.authOrigin+'/diagnostics/application'+clientQuery);
      if(!cancelled) {status('보고서 접수를 준비하는 중…');await issue();await upload();}
      if(cancelled) uploadStatus='진단이 중단되었습니다. 현재 결과는 로컬에 남아 있습니다.';
      status(cancelled?'진단이 중단되었습니다.':'진단을 마쳤습니다. 아래 결과와 접수 상태를 확인하세요.');
    } finally {clearTimeout(total);running=false;if($('start')) $('start').disabled=false;if($('cancel')) $('cancel').disabled=true;render();}
  }
  function cancel(){cancelled=true;active?.abort();}
  async function fetchImpl(url,options={}) {
    const target=new URL(typeof url==='string'?url:url.url,location.origin);
    let stage=target.origin===settings.authOrigin&&target.pathname==='/token'?'token':target.origin===settings.authOrigin&&target.pathname==='/me'?'me':target.origin===location.origin&&target.pathname==='/__nakwol/session'?'site_session':null;
    if(!stage) return nativeFetch(url,options);
    const diagnosed=Boolean(ticket&&ticket.expires_at>Date.now());
    const headers=new Headers(options.headers);
    if(diagnosed){headers.set('X-Nakwol-Diagnostic-Reference',ticket.reference);headers.set('X-Nakwol-Diagnostic-Capability',ticket.capability);}
    const start=performance.now(),controller=new AbortController();
    const callerAbort=()=>controller.abort(options.signal?.reason);
    if(options.signal?.aborted)callerAbort();else options.signal?.addEventListener('abort',callerAbort,{once:true});
    const timer=setTimeout(()=>controller.abort(),15000);
    let reader;
    try {
      const response=await nativeFetch(url,{...options,headers,signal:controller.signal});
      const chunks=[];let size=0;
      if(response.body){
        reader=response.body.getReader();
        let rejectAbort;
        const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(new DOMException('Diagnostic request aborted','AbortError'));});
        controller.signal.addEventListener('abort',rejectAbort,{once:true});
        try {
          if(controller.signal.aborted)rejectAbort();
          for(;;){const part=await Promise.race([reader.read(),aborted]);if(part.done)break;size+=part.value.byteLength;if(size>65536)throw new Error('DIAGNOSTIC_RESPONSE_TOO_LARGE');chunks.push(part.value);}
        }finally{controller.signal.removeEventListener('abort',rejectAbort);}
      }
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const complete=new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      if(diagnosed)observe(stage,response.ok?'ok':'http_error',start,response.status);return complete;
    }
    catch(error){if(reader)reader.cancel().catch(()=>{});if(diagnosed)observe(stage,options.signal?.aborted?'cancelled':'timeout_or_cors',start);throw error;}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',callerAbort);}
  }
  async function retryLogin(auth) {
    if(settings.central)return;
    if(!ticket || ticket.expires_at<=Date.now()){status('진단 번호가 만료되었습니다. 진단 시작·다시 검사로 새 번호를 받은 뒤 로그인해 주세요.');render();return;}
    const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const verifier=encode(crypto.getRandomValues(new Uint8Array(48))),state=encode(crypto.getRandomValues(new Uint8Array(24)));
    const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    auth.storage.setItem(auth.key('transaction'),JSON.stringify({verifier,state,createdAt:Date.now()}));
    auth.storage.removeItem(auth.key('sso_suppressed'));
    save();
    const target=new URL('/authorize',settings.authOrigin);
    for(const [key,value] of Object.entries({response_type:'code',client_id:settings.clientId,redirect_uri:settings.redirectUri,code_challenge:challenge,code_challenge_method:'S256',state,diagnostic_ref:ticket.reference})) target.searchParams.set(key,value);
    location.assign(target.href);
  }
  const localReport=()=>({local_reference:localReference,issued_reference:ticket?.reference||null,server_reference:acknowledgement?ticket?.reference:null,upload_confirmed:acknowledgement,...payload()});
  const exportText=()=>JSON.stringify(localReport(),null,2);
  if($('start')) $('start').onclick=run;
  if($('cancel')) {$('cancel').onclick=cancel;$('cancel').disabled=true;}
  if($('copy')) $('copy').onclick=async()=>{try{await window.navigator.clipboard.writeText(exportText());status('보고서를 복사했습니다.');}catch{status('복사할 수 없습니다. 다운로드를 사용해 주세요.');}};
  if($('download')) $('download').onclick=()=>{
    const href=URL.createObjectURL(new Blob([exportText()],{type:'application/json'})),a=document.createElement('a');
    a.href=href;a.download='nakwol-diagnostic-'+localReference+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  if(ticket) {
    const navigation=performance.getEntriesByType('navigation')[0];
    if(navigation&&navigation.duration>0) observe('page_navigation','ok',performance.now()-Math.min(navigation.duration,120000));
  }
  render();
  return {run,cancel,upload,fetchImpl,retryLogin,localReport,hasTicket:()=>Boolean(ticket&&ticket.expires_at>Date.now())};
}
export function diagnosticMarkup(central = false) {
  return `<section class="diagnostic-card" aria-labelledby="diagnostics-title"><h2 id="diagnostics-title">접속 진단</h2>
<p>사이트와 AUTH 연결을 약 25초 안에 확인합니다. 시간 초과·CORS 오류만으로 통신사 장애를 판단하지 않습니다. Discord에서 로그인하는 시간은 AUTH 요청 시간에 포함하지 않습니다.</p>
<div class="diagnostic-actions"><button id="diagnostics-start" type="button">진단 시작·다시 검사</button><button id="diagnostics-cancel" type="button" disabled>중단</button></div>
<p id="diagnostics-status" role="status" aria-live="polite">진단을 시작하면 연결 상태를 확인하고 보고서를 전송합니다.</p>
<ol id="diagnostics-results"></ol><p id="diagnostics-reference"></p><p id="diagnostics-upload" role="status" aria-live="polite"></p>
<div class="diagnostic-actions"><button id="diagnostics-copy" type="button" disabled>보고서 복사</button><button id="diagnostics-download" type="button" disabled>다운로드</button><button id="diagnostics-login" type="button" disabled${central ? ' hidden' : ''}>진단 번호로 로그인 다시 시도</button></div>
<details><summary>보고서 내용·보관 기간</summary><p class="muted">보고서에는 단계·시간·HTTP 상태와 대략적인 브라우저 종류만 포함됩니다. 서버는 ASN·센터·CF-Ray를 관측할 수 있습니다. 계정 정보·IP·토큰·주소·오류 원문은 저장하지 않습니다. 접수 기록은 7일 후 만료됩니다.</p></details></section>`;
}
export function diagnosticScript(settings) {
  // Wrangler esbuild keepNames may inject this harmless helper into nested functions.
  return '(()=>{const __name=(target)=>target;return ('+diagnosticRuntime.toString()+')('+JSON.stringify(settings).replaceAll('<','\\u003c')+');})()';
}
export const diagnosticStyles = `body{font:16px/1.6 system-ui,sans-serif;background:#0b1020;color:#f1f5f9;margin:0}main{max-width:720px;margin:40px auto;padding:20px}.diagnostic-card{background:#111a2b;border:1px solid #29364b;border-radius:16px;padding:24px;margin-top:24px}button,a{font:inherit}button{min-height:44px;border:1px solid #29364b;border-radius:8px;padding:8px 14px;background:#5865f2;color:#f1f5f9;cursor:pointer}button:disabled{opacity:.6;cursor:default}button:focus-visible,a:focus-visible{outline:2px solid #f1f5f9;outline-offset:3px}.diagnostic-actions{display:flex;flex-wrap:wrap;gap:8px}a{color:#a6b3c7}.muted{color:#a6b3c7;font-size:13px}li{padding:8px 0;overflow-wrap:anywhere}#diagnostics-reference{overflow-wrap:anywhere}@media(max-width:600px){main{margin:16px auto;padding:16px}.diagnostic-card{padding:16px}.diagnostic-actions button{flex:1 1 auto}}`;
export function diagnosticsPage(settings) {
  const serviceLink=settings.central&&settings.siteOrigin?'<p><a id="diagnostics-service">서비스에서 진단 로그인하기</a></p>':'';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>NAKWOL 접속 진단</title><style>${diagnosticStyles}</style></head>
<body><main><h1>NAKWOL 접속 진단</h1><p id="diagnostics-service-name"></p>${diagnosticMarkup(settings.central)}${serviceLink}<p class="muted">로그인 다시 시도는 서비스의 공통 진단 화면에서 진행합니다.</p></main>
<script>window.nakwolDiagnostics=${diagnosticScript(settings)};document.getElementById("diagnostics-service-name").textContent=${JSON.stringify(settings.clientName ? settings.clientName+' 접속 상태를 확인합니다.' : settings.clientId ? settings.clientId+' 접속 상태를 확인합니다.' : '서비스의 로그인 화면에서 진단 링크를 열면 앱 설정도 함께 확인합니다.').replaceAll('<','\\u003c')};${serviceLink?'document.getElementById("diagnostics-service").href='+JSON.stringify(settings.siteOrigin+'/__nakwol/diagnostics').replaceAll('<','\\u003c')+';':''}</script><script type="module">const settings=${JSON.stringify(settings).replaceAll('<','\\u003c')};
if(!settings.central) document.getElementById('diagnostics-login').onclick=async()=>{const button=document.getElementById('diagnostics-login');button.disabled=true;try{const sdk=await Promise.race([import(settings.authOrigin+'/sdk/v0.3.3/nakwol-auth-web.js'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),7000))]);const auth=new sdk.NakwolAuthClient({...settings,autoSso:false,fetchImpl:window.nakwolDiagnostics.fetchImpl});await window.nakwolDiagnostics.retryLogin(auth);}catch{document.getElementById('diagnostics-status').textContent='로그인 모듈을 확인할 수 없습니다. 진단 보고서를 관리자에게 전달하세요.';button.disabled=false;}};</script></body></html>`;
}
