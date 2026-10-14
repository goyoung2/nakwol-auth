import type { MiddlewareHandler } from 'hono';
import { randomToken } from './crypto';
import type { Env } from './types';

export const loginWait: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Vary', 'Accept, X-Nakwol-Login-Wait');
  if (c.req.header('X-Nakwol-Login-Wait') === '1') {
    await next();
    const location = c.res.headers.get('Location');
    if (c.res.status === 302 && location) {
      // Preserve HttpOnly Set-Cookie without letting fetch follow the cross-origin redirect.
      const headers = new Headers(c.res.headers);
      headers.delete('Location');
      c.res.headers.delete('Location');
      headers.set('Content-Type', 'application/json; charset=UTF-8');
      c.res = new Response(JSON.stringify({ location }), { status: 200, headers });
    }
    return;
  }
  if (!c.req.header('Accept')?.includes('text/html')) { await next(); return; }
  const nonce = randomToken(18);
  c.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  return c.html(renderLoginWait(nonce));
};

export function renderLoginWait(nonce: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 확인 중 · 낙월</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#0b1020;--surface:#111a2b;--text:#f1f5f9;--muted:#a6b3c7;--border:#29364b;--action:#5865f2}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;padding:20px}main{width:100%;max-width:720px;padding:24px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}h1{font-size:24px;margin:16px 0}p{line-height:1.6;color:var(--muted)}small{color:var(--muted)}progress{display:block;width:100%;height:8px;margin:24px 0;accent-color:var(--action)}nav{display:flex;flex-wrap:wrap;gap:16px;margin-top:24px}a{color:var(--text);display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--border);border-radius:8px;text-decoration:none}a:focus-visible{outline:2px solid var(--action);outline-offset:4px}[hidden]{display:none!important}@media(prefers-reduced-motion:reduce){progress{appearance:none;background:var(--border)}progress::-webkit-progress-inner-element{visibility:hidden}}@media(max-width:520px){body{padding:16px}main{padding:20px}}
</style></head><body><main aria-busy="true"><small>NAKWOL AUTH</small><h1 id="title">로그인 확인 중</h1><p id="status" role="status" aria-live="polite">Discord 인증 결과와 서비스 이용 권한을 확인하고 있습니다.</p><progress aria-label="로그인 확인 중"></progress><small id="elapsed" aria-live="off"></small><nav><a id="return" hidden>서비스로 돌아가 다시 로그인</a><a href="/account">계정 도움말</a></nav><noscript><p>로그인을 완료하려면 JavaScript를 켠 뒤 서비스에서 다시 로그인해 주세요.</p></noscript></main>
<script nonce="${nonce}">(() => {
  const endpoint = location.href;
  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('status'), title = document.getElementById('title');
  const started = Date.now(), controller = new AbortController();
  const clock = setInterval(() => { document.getElementById('elapsed').textContent = Math.floor((Date.now()-started)/1000)+'초 경과'; }, 1000);
  const slow = setTimeout(() => { status.textContent = '연결이 평소보다 오래 걸리고 있습니다. 확인을 계속 진행하고 있으니 잠시 기다려 주세요.'; }, 3000);
  const longer = setTimeout(() => { status.textContent = '아직 인증 서버의 응답을 기다리고 있습니다. 완료되면 서비스로 자동 이동합니다.'; }, 15000);
  const limit = setTimeout(() => controller.abort(), 75000);
  function stop() { clearInterval(clock); clearTimeout(slow); clearTimeout(longer); clearTimeout(limit); document.querySelector('main').setAttribute('aria-busy','false'); document.querySelector('progress').hidden=true; }
  function failed(message) { stop(); title.textContent='로그인을 완료하지 못했습니다'; status.textContent=message; }
  fetch(endpoint, {headers:{'Accept':'application/json','X-Nakwol-Login-Wait':'1'},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal})
    .then(async response => {
      if (!response.ok) throw new Error('LOGIN_FAILED');
      const result=await response.json();
      if (typeof result.location !== 'string') throw new Error('LOGIN_FAILED');
      const target=new URL(result.location);
      if (!['https:','http:'].includes(target.protocol) || target.username || target.password) throw new Error('LOGIN_FAILED');
      if (target.searchParams.has('error')) {
        failed(target.searchParams.get('error')==='access_denied' ? '이 서비스의 이용 권한을 확인하지 못했습니다. 계정 도움말에서 자격을 확인하거나 관리자에게 문의해 주세요.' : '인증 요청을 완료하지 못했습니다. 서비스로 돌아가 새 로그인을 시작해 주세요.');
        const back=document.getElementById('return');back.href=target.href;back.hidden=false;return;
      }
      stop(); title.textContent='로그인 확인 완료';status.textContent='서비스로 이동합니다.';location.replace(target.href);
    }).catch(() => failed('인증 서버와의 연결을 완료하지 못했습니다. 원래 서비스로 돌아가 새 로그인을 시작하거나 계정 도움말을 이용해 주세요.'));
})();
</script></body></html>`;
}
