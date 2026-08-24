import type { Hono } from 'hono';
import type { Env } from './types';

const CLIENT_ID = 'nakwol-auth-selftest';

function pageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NAKWOL AUTH Self Test</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
    body{margin:0;min-height:100vh;background:#0f172a;color:#e5e7eb;display:grid;place-items:center}
    main{width:min(760px,calc(100% - 32px));background:#111827;border:1px solid #374151;border-radius:18px;padding:28px;box-sizing:border-box}
    h1{margin:0 0 8px;font-size:28px}.muted{color:#9ca3af}.row{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
    button{border:0;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer}.primary{background:#5865f2;color:white}.secondary{background:#374151;color:#f9fafb}
    .card{background:#0b1220;border:1px solid #253047;border-radius:14px;padding:18px;margin-top:16px}.grid{display:grid;grid-template-columns:150px 1fr;gap:8px 14px}
    code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;word-break:break-word;background:#020617;border-radius:10px;padding:14px;overflow:auto}
    .ok{color:#86efac}.bad{color:#fca5a5}.badge{display:inline-block;padding:3px 9px;border-radius:999px;background:#1f2937;font-size:13px}
  </style>
</head>
<body>
<main>
  <div class="muted">落月 · NAKWOL AUTH</div>
  <h1>통합 로그인 자가진단</h1>
  <p class="muted">Discord OAuth → Nakwol ID → Guild/Role 판정 → Access Token → /me 전체 흐름을 시험합니다.</p>
  <div class="row">
    <button id="login" class="primary">Discord로 로그인</button>
    <button id="refresh" class="secondary">현재 사용자 확인</button>
    <button id="logoutApp" class="secondary">이 앱 로그아웃</button>
    <button id="logoutSso" class="secondary">전체 SSO 로그아웃</button>
  </div>
  <div id="summary" class="card">로그인 상태를 확인하는 중입니다.</div>
  <div class="card"><strong>원본 /me 응답</strong><pre id="raw">-</pre></div>
</main>
<script>
(() => {
  const CLIENT_ID = ${JSON.stringify(CLIENT_ID)};
  const REDIRECT_URI = location.origin + '/demo/callback';
  const TOKEN_KEY = 'nakwol_selftest_access_token';
  const PKCE_KEY = 'nakwol_selftest_pkce';
  const summary = document.querySelector('#summary');
  const raw = document.querySelector('#raw');

  const bytesToBase64Url = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
  };
  const randomValue = (size = 32) => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
  const challengeFor = async (verifier) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return bytesToBase64Url(new Uint8Array(digest));
  };

  async function startLogin() {
    const verifier = randomValue(48);
    const state = randomValue(24);
    const challenge = await challengeFor(verifier);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, redirectUri: REDIRECT_URI }));
    const url = new URL('/authorize', location.origin);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    location.assign(url.toString());
  }

  async function exchangeCallback() {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const code = params.get('code');
    if (!error && !code) return false;
    if (error) throw new Error('OAuth error: ' + error);
    const stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    if (!stored || !stored.verifier || stored.state !== params.get('state')) throw new Error('OAuth state/PKCE 정보가 일치하지 않습니다.');
    const response = await fetch('/token?client_id=' + encodeURIComponent(CLIENT_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: stored.verifier,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(payload));
    sessionStorage.removeItem(PKCE_KEY);
    sessionStorage.setItem(TOKEN_KEY, payload.access_token);
    history.replaceState({}, '', '/demo');
    return true;
  }

  async function showUser() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      summary.innerHTML = '<span class="badge">미로그인</span><p>위의 <b>Discord로 로그인</b> 버튼을 눌러 첫 인증을 시작하세요.</p>';
      raw.textContent = '-';
      return;
    }
    const response = await fetch('/me?client_id=' + encodeURIComponent(CLIENT_ID), {
      headers: { Authorization: 'Bearer ' + token },
    });
    const payload = await response.json();
    raw.textContent = JSON.stringify(payload, null, 2);
    if (!response.ok || !payload.ok) {
      sessionStorage.removeItem(TOKEN_KEY);
      summary.innerHTML = '<span class="bad">토큰이 유효하지 않습니다.</span>';
      return;
    }
    const u = payload.data;
    const m = u.membership || {};
    const cls = m.is_member ? 'ok' : 'bad';
    summary.innerHTML = '<div class="grid">' +
      '<div>NAKWOL ID</div><div><code>' + escapeHtml(u.id) + '</code></div>' +
      '<div>표시명</div><div>' + escapeHtml(u.display_name) + '</div>' +
      '<div>Discord 서버</div><div>' + (m.is_guild_member ? '가입됨' : '미가입') + '</div>' +
      '<div>낙월 맹원</div><div class="' + cls + '">' + (m.is_member ? '인증 성공' : '권한 없음') + '</div>' +
      '<div>사이트 Role</div><div><b>' + escapeHtml(m.role || 'user') + '</b></div>' +
      '</div>';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function appLogout() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
      await fetch('/logout?client_id=' + encodeURIComponent(CLIENT_ID), {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
      }).catch(() => {});
    }
    sessionStorage.removeItem(TOKEN_KEY);
    await showUser();
  }

  document.querySelector('#login').addEventListener('click', startLogin);
  document.querySelector('#refresh').addEventListener('click', showUser);
  document.querySelector('#logoutApp').addEventListener('click', appLogout);
  document.querySelector('#logoutSso').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    const u = new URL('/session/logout', location.origin);
    u.searchParams.set('client_id', CLIENT_ID);
    u.searchParams.set('return_to', location.origin + '/demo');
    location.assign(u.toString());
  });

  (async () => {
    try { await exchangeCallback(); await showUser(); }
    catch (e) { summary.innerHTML = '<span class="bad">' + escapeHtml(e instanceof Error ? e.message : e) + '</span>'; }
  })();
})();
</script>
</body>
</html>`;
}

export function registerDemoRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/demo', (c) => c.html(pageHtml()));
  app.get('/demo/callback', (c) => c.html(pageHtml()));
}
