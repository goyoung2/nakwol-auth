import { diagnosticMarkup, diagnosticScript, diagnosticStyles, diagnosticsPage } from './diagnostics.mjs';
export { diagnosticsPage };
export function loginPage(settings, status) {
  const data = JSON.stringify({ clientId: settings.clientId, authOrigin: settings.authOrigin, redirectUri: settings.siteUrl, status, sitePing: true }).replaceAll('<', '\u003c');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>NAKWOL 로그인</title>
<style>body{font:18px system-ui;background:#f6f3eb;color:#182235;margin:0}main{max-width:520px;margin:12vh auto;padding:24px}button{font:inherit;padding:12px;margin:6px 6px 6px 0}p{line-height:1.6}</style><style>${diagnosticStyles}</style>
<main><h1>NAKWOL</h1><p id="status" role="status" aria-live="polite">접속 확인 중…</p><progress id="login-progress" aria-label="접속 확인 중"></progress><button id="login" hidden>Discord로 로그인</button><button id="retry" hidden>다시 확인</button><p><a id="recovery" hidden>계정 확인·접속 문제 해결</a></p><noscript><p>로그인하려면 JavaScript를 켜 주세요.</p></noscript>${diagnosticMarkup()}</main>
<script type="module">
const settings=${data};
const diagnostic=${diagnosticScript({clientId:settings.clientId,authOrigin:settings.authOrigin,redirectUri:settings.siteUrl,sitePing:true})};
window.nakwolDiagnostics=diagnostic;
const uploadDiagnostic=async()=>{if(diagnostic.hasTicket()&&diagnostic.localReport().observations.length)await diagnostic.upload();};
const statusEl=document.getElementById('status'), login=document.getElementById('login'), retry=document.getElementById('retry');
const progress=document.getElementById('login-progress');
let delayTimer;
const waiting=()=>{clearTimeout(delayTimer);progress.hidden=false;delayTimer=setTimeout(()=>{statusEl.textContent='연결이 평소보다 오래 걸리고 있습니다. 확인을 계속 진행하고 있으니 잠시 기다려 주세요.';},3000);};
const stopWaiting=()=>{clearTimeout(delayTimer);progress.hidden=true;};
waiting();
const recovery=document.getElementById('recovery');
const recoveryUrl=new URL('/account',settings.authOrigin);recoveryUrl.searchParams.set('client_id',settings.clientId);recoveryUrl.searchParams.set('recovery','1');recovery.href=recoveryUrl.href;
const key='nakwol:server:return:'+settings.clientId;
const safe=p=>typeof p==='string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/__nakwol/') && !/[\\\\\\u0000-\\u001f]/.test(p) && new URL(p,location.origin).origin===location.origin;
const currentPath=location.pathname+location.search+location.hash;
const callback=new URLSearchParams(location.search);
const isCallback=callback.has('state')&&(callback.has('code')||callback.has('error'));
try { if(!isCallback && currentPath!=='/' && safe(currentPath)) sessionStorage.setItem(key,JSON.stringify({path:currentPath,at:Date.now()})); } catch { /* Return to root when storage is unavailable. */ }
retry.onclick=()=>location.reload();
const fail=(code)=>{stopWaiting();login.hidden=false;recovery.hidden=false;statusEl.textContent=code==='access_denied'||code===403?'이 사이트의 접근 권한이 없습니다. member 사이트는 시즌3 역할이 필요하며 추가 역할 조건이 있을 수 있습니다. 역할을 받았다면 계정 페이지에서 다시 확인해 주세요. 관리자 차단이나 서비스 설정 문제는 관리자 확인이 필요합니다.':code==='SDK_UNAVAILABLE'?'로그인 모듈을 불러오지 못했습니다. 연결을 확인한 뒤 로그인 버튼으로 다시 시도하거나 보고서를 다운로드해 주세요.':code===503?'인증 서버를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.':'로그인을 완료하지 못했습니다. 다시 로그인해 주세요.';login.disabled=false;retry.hidden=false;};
let auth=null, loading=null;
const loadAuth=(automatic=false)=>{
 if(auth)return Promise.resolve(auth);
 if(loading)return loading;
 loading=(async()=>{
  let timer;
  try {
   const {NakwolAuthClient}=await Promise.race([import(settings.authOrigin+'/sdk/v0.3.4/nakwol-auth-web.js'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SDK_UNAVAILABLE')),45000);})]);
   auth=new NakwolAuthClient({...settings,fetchImpl:diagnostic.fetchImpl,autoSso:automatic&&settings.status===401&&!diagnostic.hasTicket()});
   return auth;
  } catch {throw Object.assign(new Error('SDK_UNAVAILABLE'),{code:'SDK_UNAVAILABLE'});}
  finally {clearTimeout(timer);}
 })().finally(()=>{loading=null;});
 return loading;
};
const diagnosticLogin=document.getElementById('diagnostics-login');
const manualLogin=async(useDiagnostic)=>{
 waiting();login.disabled=true;diagnosticLogin.disabled=true;
 statusEl.textContent='로그인 모듈을 다시 확인하는 중…';
 try {const client=await loadAuth();if(useDiagnostic)await diagnostic.retryLogin(client);else{client.clearLocalState();await client.login();}}
 catch(error){fail(error.code);if(useDiagnostic){const target=document.getElementById('diagnostics-status');if(target)target.textContent='로그인 모듈을 불러오지 못해 진단 로그인을 시작하지 못했습니다. 연결을 확인하고 다시 시도하거나 보고서를 다운로드해 주세요.';}}
 finally {stopWaiting();login.disabled=false;diagnosticLogin.disabled=!diagnostic.hasTicket();}
};
diagnosticLogin.onclick=()=>manualLogin(true);
login.onclick=()=>manualLogin(false);
try {
 await loadAuth(true);
 if(settings.status===503){fail(503);}else{
 const user=await auth.bootstrap();
 if(!user){login.hidden=false;statusEl.textContent='Discord로 로그인하면 사이트 접근 권한을 확인합니다.';await uploadDiagnostic();}else{
 const result=await diagnostic.fetchImpl('/__nakwol/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:auth.getAccessToken()}),signal:AbortSignal.timeout(45000)});
 if(!result.ok){if(result.status===401||result.status===403)auth.clearDeniedLogin({code:'access_denied'});fail(result.status);await uploadDiagnostic();}else{
 // A disabled cookie must not cause an endless successful-login redirect loop.
 const attemptsKey=key+':attempts'; const attempts=JSON.parse(sessionStorage.getItem(attemptsKey)||'[]').filter(t=>Date.now()-t<60000);
 if(attempts.length>=2){sessionStorage.removeItem(attemptsKey);statusEl.textContent='로그인 쿠키를 저장하지 못했습니다. 이 사이트의 쿠키를 허용한 뒤 다시 확인해 주세요.';retry.hidden=false;recovery.hidden=false;await uploadDiagnostic();}else{
 sessionStorage.setItem(attemptsKey,JSON.stringify([...attempts,Date.now()]));
 let target='/';try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');sessionStorage.removeItem(key);if(saved&&Date.now()-saved.at<600000&&safe(saved.path))target=saved.path;}catch{}
 await uploadDiagnostic();
 location.replace(target);
 }
 }
 }
 }
} catch(error){fail(error.code);await uploadDiagnostic();}finally{stopWaiting();}
</script></html>`;
}
