import type { Hono } from 'hono';
import type { Env } from './types';
import { jsonError, parseCookies } from './http';
import { findSessionUser, getUserWithMembership, inspectAccessToken } from './store';
import { getAuthLabPrivilege, safeLabDiagnosticShape } from './platform-access';

export const LAB_CLIENT_ID = 'nakwol-auth-lab';
const LAB_REDIRECT_URI = 'https://nakwol-auth.sepsd21.workers.dev/lab';

function bearerToken(header: string | undefined): string | null {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function labPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>NAKWOL AUTH LAB</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e7eb;background:#070b14}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0,#172554 0,#0b1020 38%,#050811 100%);color:#e5e7eb}
    button{font:inherit}.shell{width:min(980px,calc(100% - 32px));margin:0 auto;padding:30px 0 54px}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}.brand small{display:block;color:#93c5fd;letter-spacing:.12em}.brand h1{margin:5px 0 0;font-size:clamp(26px,4vw,38px)}.subtitle{margin:9px 0 0;color:#94a3b8;line-height:1.55}
    .panel,.notice{border:1px solid #273449;background:rgba(15,23,42,.9);box-shadow:0 18px 44px rgba(0,0,0,.22);backdrop-filter:blur(10px);border-radius:18px}.panel{padding:20px}.notice{padding:20px}.notice.warning{border-color:#854d0e;background:rgba(66,32,6,.72)}.notice.error{border-color:#7f1d1d;background:rgba(69,10,10,.7);color:#fecaca}[hidden]{display:none!important}
    .actions{display:flex;gap:9px;flex-wrap:wrap;margin:16px 0 0}.button{appearance:none;border:1px solid transparent;border-radius:10px;padding:9px 13px;min-height:40px;background:#5865f2;color:white;font-weight:800;cursor:pointer}.button.secondary{background:#172033;border-color:#334155;color:#e2e8f0}.button.danger{background:#7f1d1d}.button:focus-visible{outline:2px solid #a5b4fc;outline-offset:3px}
    .diagnostics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:18px}.check{border:1px solid #334155;background:#0b1220;border-radius:13px;padding:13px}.check-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}.check-name{font-size:13px;font-weight:800;color:#cbd5e1}.status{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:3px 8px;min-width:48px;font-size:11px;font-weight:900}.status.pass{background:#052e16;color:#86efac}.status.fail{background:#450a0a;color:#fca5a5}.status.info{background:#172554;color:#bfdbfe}.check-value{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#94a3b8;overflow-wrap:anywhere}.legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;color:#94a3b8;font-size:12px}.legend strong{color:#cbd5e1}.privacy{margin-top:18px;padding-top:15px;border-top:1px solid #273449;color:#94a3b8;font-size:12px;line-height:1.55}
    @media(max-width:700px){.header{flex-direction:column}.diagnostics{grid-template-columns:1fr}.actions{display:grid;grid-template-columns:1fr}.button{width:100%}}
  </style>
</head>
<body>
  <main class="shell" id="lab-root">
    <header class="header">
      <div class="brand">
        <small>落月 · NAKWOL AUTH</small>
        <h1>AUTH LAB</h1>
        <p class="subtitle">통합 로그인, 중앙 SSO 세션, 앱 전용 인증 상태와 권한 경계를 안전한 메타데이터만으로 확인합니다.</p>
      </div>
      <div id="lab-identity" aria-live="polite">상태 확인 중</div>
    </header>

    <section id="lab-login" class="notice" hidden>
      <strong>Auth Lab 테스트 로그인이 필요합니다.</strong>
      <p>Lab 전용 OAuth 클라이언트로 인증 흐름을 시작합니다.</p>
      <button id="test-login" class="button" type="button">테스트 로그인 시작</button>
    </section>

    <section id="lab-forbidden" class="notice warning" hidden>
      <strong>진단 권한 없음</strong>
      <p>NAKWOL 관리자 또는 활성 Connect developer/operator만 이 진단 화면을 사용할 수 있습니다.</p>
      <div class="actions"><button id="forbidden-logout" class="button secondary" type="button">앱 로그아웃</button></div>
    </section>

    <section id="lab-panel" class="panel" hidden>
      <div>
        <strong>안전 진단 결과</strong>
        <p class="subtitle">PASS/FAIL은 세션과 앱 인증 상태를, INFO는 식별·구성 메타데이터를 뜻합니다.</p>
      </div>
      <div id="diagnostics" class="diagnostics" aria-live="polite"></div>
      <div class="legend"><span><strong>PASS</strong> 정상</span><span><strong>FAIL</strong> 확인 필요</span><span><strong>INFO</strong> 안전 메타데이터</span></div>
      <div class="actions">
        <button id="refresh-me" class="button secondary" type="button">/me 다시 확인</button>
        <button id="logout-app" class="button secondary" type="button">앱 로그아웃</button>
        <button id="test-sso" class="button secondary" type="button">SSO 재로그인 테스트</button>
        <button id="logout-global" class="button danger" type="button">전체 로그아웃</button>
      </div>
      <div class="privacy">이 화면은 인증 문자열 자체가 아니라 유효 여부, 만료 시각, NAKWOL ID, 클라이언트와 권한 역할처럼 검증에 필요한 제한된 정보만 표시합니다.</div>
    </section>

    <section id="lab-error" class="notice error" hidden aria-live="assertive"></section>
  </main>

  <script type="module">
    import { NakwolAuthClient } from '/sdk/v0.2.0/nakwol-auth-web.js';

    const LAB_CLIENT_ID = 'nakwol-auth-lab';
    const auth = new NakwolAuthClient({
      clientId: LAB_CLIENT_ID,
      redirectUri: location.origin + '/lab',
    });

    const identity = document.querySelector('#lab-identity');
    const loginState = document.querySelector('#lab-login');
    const forbiddenState = document.querySelector('#lab-forbidden');
    const panelState = document.querySelector('#lab-panel');
    const errorState = document.querySelector('#lab-error');
    const diagnosticsRoot = document.querySelector('#diagnostics');

    const fieldSpec = [
      ['central_session', '중앙 SSO 세션', 'boolean'],
      ['app_access_token', 'Lab 앱 인증', 'boolean'],
      ['me_status', '/me 상태', 'status'],
      ['nakwol_id', 'NAKWOL ID', 'info'],
      ['client_id', 'Client ID', 'info'],
      ['redirect_uri', 'Redirect URI', 'info'],
      ['pkce_method', 'PKCE 방식', 'info'],
      ['token_expires_at', '앱 인증 만료 시각', 'date'],
      ['membership_role', '낙월 역할', 'info'],
      ['developer_role', 'Connect 역할', 'info'],
    ];

    function hideStates() {
      loginState.hidden = true;
      forbiddenState.hidden = true;
      panelState.hidden = true;
      errorState.hidden = true;
    }

    function setIdentity(user) {
      identity.textContent = user ? (user.display_name || user.id || 'NAKWOL ID') : '로그인하지 않음';
    }

    function showError(message) {
      hideStates();
      errorState.textContent = message || 'Auth Lab 진단 중 오류가 발생했습니다.';
      errorState.hidden = false;
    }

    function statusFor(kind, value) {
      if (kind === 'boolean') return { label: value === true ? 'PASS' : 'FAIL', className: value === true ? 'pass' : 'fail' };
      if (kind === 'status') return { label: Number(value) === 200 ? 'PASS' : 'FAIL', className: Number(value) === 200 ? 'pass' : 'fail' };
      return { label: 'INFO', className: 'info' };
    }

    function displayValue(kind, value) {
      if (kind === 'boolean') return value === true ? '정상' : '불일치 또는 없음';
      if (kind === 'date') return value ? new Date(Number(value)).toLocaleString('ko-KR') : '없음';
      if (value === null || value === undefined || value === '') return '없음';
      return String(value);
    }

    function renderDiagnostics(data) {
      while (diagnosticsRoot.firstChild) diagnosticsRoot.removeChild(diagnosticsRoot.firstChild);
      for (const [key, label, kind] of fieldSpec) {
        const card = document.createElement('article');
        card.className = 'check';
        const head = document.createElement('div');
        head.className = 'check-head';
        const name = document.createElement('span');
        name.className = 'check-name';
        name.textContent = label;
        const badge = document.createElement('span');
        const state = statusFor(kind, data[key]);
        badge.className = 'status ' + state.className;
        badge.textContent = state.label;
        head.append(name, badge);
        const value = document.createElement('div');
        value.className = 'check-value';
        value.textContent = displayValue(kind, data[key]);
        card.append(head, value);
        diagnosticsRoot.appendChild(card);
      }
    }

    async function loadDiagnostics() {
      const response = await fetch('/lab/api/diagnostics', {
        headers: { Authorization: 'Bearer ' + auth.getAccessToken() },
      });
      if (response.status === 403) {
        hideStates();
        forbiddenState.hidden = false;
        return null;
      }
      if (response.status === 401) {
        await auth.logout();
        hideStates();
        loginState.hidden = false;
        return null;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error?.message || '진단 정보를 불러오지 못했습니다.');
      }
      renderDiagnostics(payload.data);
      hideStates();
      panelState.hidden = false;
      return payload.data;
    }

    document.querySelector('#test-login').onclick = () => auth.login();
    document.querySelector('#refresh-me').onclick = async () => { await auth.getMe(); await loadDiagnostics(); };
    document.querySelector('#logout-app').onclick = async () => { await auth.logout(); location.reload(); };
    document.querySelector('#forbidden-logout').onclick = async () => { await auth.logout(); location.reload(); };
    document.querySelector('#test-sso').onclick = () => auth.login();
    document.querySelector('#logout-global').onclick = () => auth.logout({ global: true, returnTo: location.origin + '/lab' });

    try {
      const user = await auth.bootstrap();
      setIdentity(user);
      if (!user) {
        hideStates();
        loginState.hidden = false;
      } else {
        await loadDiagnostics();
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  </script>
</body>
</html>`;
}

export function registerLabRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/lab', (c) => c.html(labPageHtml()));

  app.get('/lab/api/diagnostics', async (c) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) return jsonError(c, 401, 'LAB_AUTH_REQUIRED', 'Auth Lab 로그인이 필요합니다.');

    const tokenInfo = await inspectAccessToken(c.env, token, LAB_CLIENT_ID);
    if (!tokenInfo) return jsonError(c, 401, 'INVALID_LAB_TOKEN', 'Auth Lab access token이 유효하지 않습니다.');

    const privilege = await getAuthLabPrivilege(c.env, tokenInfo.userId);
    if (!privilege.canUseLab) {
      return jsonError(c, 403, 'LAB_FORBIDDEN', 'Auth Lab 진단 권한이 없습니다.');
    }

    const user = await getUserWithMembership(c.env, tokenInfo.userId);
    if (!user) return jsonError(c, 404, 'LAB_USER_NOT_FOUND', 'NAKWOL 사용자를 찾을 수 없습니다.');

    const sid = parseCookies(c.req.header('Cookie')).nakwol_sid;
    const sessionUserId = await findSessionUser(c.env, sid);

    const data = safeLabDiagnosticShape({
      centralSession: sessionUserId === tokenInfo.userId,
      appAccessToken: true,
      meStatus: 200,
      nakwolId: user.id,
      clientId: tokenInfo.clientId,
      redirectUri: LAB_REDIRECT_URI,
      pkceMethod: 'S256',
      tokenExpiresAt: tokenInfo.expiresAt,
      membershipRole: privilege.membershipRole,
      developerRole: privilege.developerRole,
    });

    return c.json({ ok: true, data });
  });
}
