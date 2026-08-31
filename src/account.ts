import type { Hono } from 'hono';
import type { Env } from './types';
import { jsonError } from './http';
import { authenticateAccessToken, getUserWithMembership } from './store';
import { listConnectedServices } from './account-store';

export const ACCOUNT_CLIENT_ID = 'nakwol-account-center';

function bearerToken(header: string | undefined): string | null {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function accountPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>NAKWOL 계정</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fafc;background:#0b1020}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#172554 0,#0b1020 42%,#060913 100%);color:#f8fafc}
    button,a{font:inherit}.shell{width:min(1040px,calc(100% - 32px));margin:0 auto;padding:28px 0 52px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.brand small{display:block;color:#94a3b8;letter-spacing:.12em}.brand h1{margin:4px 0 0;font-size:clamp(25px,4vw,36px)}
    .hero,.card{border:1px solid #253047;background:rgba(15,23,42,.86);box-shadow:0 18px 46px rgba(0,0,0,.2);backdrop-filter:blur(12px)}.hero{border-radius:22px;padding:26px;margin-bottom:18px}.hero p{margin:8px 0 0;color:#94a3b8;line-height:1.65}.card{border-radius:16px;padding:18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wide{grid-column:1/-1}
    .eyebrow{font-size:12px;font-weight:800;letter-spacing:.08em;color:#a5b4fc;text-transform:uppercase}.card h2{font-size:16px;margin:5px 0 14px}.muted{color:#94a3b8}.value{font-weight:800;word-break:break-word}.stack{display:grid;gap:9px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.badge{display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border-radius:999px;background:#172554;color:#c7d2fe;font-size:12px;font-weight:800}.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:9px 14px;border:0;border-radius:11px;background:#5865f2;color:#fff;font-weight:800;cursor:pointer;text-decoration:none}.button.secondary{background:#1e293b;color:#e2e8f0;border:1px solid #334155}.button.danger{background:#7f1d1d}.button:focus-visible,a:focus-visible{outline:2px solid #a5b4fc;outline-offset:3px}
    [hidden]{display:none!important}.notice{border-radius:14px;padding:16px;border:1px solid #334155;background:#111827}.notice.error{border-color:#7f1d1d;color:#fecaca;background:#2b1116}.service{display:grid;gap:8px;padding:14px;border:1px solid #334155;border-radius:13px;background:#0b1220}.service[data-selected="true"]{border-color:#818cf8;box-shadow:0 0 0 1px #818cf8}.service a{color:#c7d2fe;text-decoration:none;font-weight:800}.service a:hover{text-decoration:underline}.permissions-list{margin:8px 0 0;padding-left:20px;color:#cbd5e1}.permission-empty{color:#94a3b8}.footer-actions{display:flex;justify-content:flex-end;margin-top:18px}
    @media (max-width:720px){.topbar{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}.wide{grid-column:auto}.row{align-items:flex-start;flex-direction:column}.footer-actions{justify-content:stretch}.footer-actions .button{width:100%}}
  </style>
</head>
<body>
  <main class="shell" id="account-root">
    <header class="topbar">
      <div class="brand"><small>落月 · NAKWOL AUTH</small><h1>내 낙월 계정</h1></div>
      <div id="account-identity" aria-live="polite"></div>
    </header>

    <section class="hero">
      <div class="eyebrow">Account Center</div>
      <h2>NAKWOL ID와 서비스 연결 상태를 한 곳에서 확인합니다.</h2>
      <p>표시되는 연결 서비스는 이 계정으로 실제 인증에 성공한 기록만 기준으로 합니다.</p>
    </section>

    <section id="logged-out" class="notice" hidden>
      <strong>NAKWOL 계정 로그인이 필요합니다.</strong>
      <p class="muted">Discord 인증 후 NAKWOL ID와 연결된 서비스 권한을 확인할 수 있습니다.</p>
      <button id="login" class="button" type="button">Discord로 낙월 로그인</button>
    </section>

    <section id="account-content" hidden>
      <div class="grid">
        <section id="profile-card" class="card">
          <div class="eyebrow">NAKWOL ID</div>
          <h2>프로필</h2>
          <div class="stack">
            <div><div class="muted">표시 이름</div><div id="profile-name" class="value">-</div></div>
            <div><div class="muted">NAKWOL ID</div><div id="profile-id" class="value">-</div></div>
          </div>
        </section>

        <section id="membership-card" class="card">
          <div class="eyebrow">Membership</div>
          <h2>낙월 소속 상태</h2>
          <div class="stack">
            <div class="row"><span class="muted">현재 역할</span><span id="membership-role" class="badge">-</span></div>
            <div class="row"><span class="muted">맹원 인증</span><span id="membership-state" class="value">-</span></div>
          </div>
        </section>

        <section id="services-card" class="card wide">
          <div class="eyebrow">Connections</div>
          <h2>연결된 서비스</h2>
          <div id="services" class="stack"></div>
        </section>

        <section id="permissions" class="card wide">
          <div class="eyebrow">Permissions</div>
          <h2>서비스 권한</h2>
          <div id="permission-detail" class="permission-empty">연결된 서비스를 선택하면 이 서비스가 확인하는 AUTH 권한을 표시합니다.</div>
        </section>
      </div>

      <div class="footer-actions">
        <button id="global-logout" class="button danger" type="button">모든 낙월 서비스에서 로그아웃</button>
      </div>
    </section>

    <section id="account-error" class="notice error" hidden aria-live="assertive"></section>
  </main>

  <script type="module">
    import { NakwolAuthClient } from '/sdk/v0.2.0/nakwol-auth-web.js';

    const ACCOUNT_CLIENT_ID = 'nakwol-account-center';
    const auth = new NakwolAuthClient({
      clientId: ACCOUNT_CLIENT_ID,
      redirectUri: location.origin + '/account',
    });

    const identity = document.querySelector('#account-identity');
    const loggedOut = document.querySelector('#logged-out');
    const content = document.querySelector('#account-content');
    const errorBox = document.querySelector('#account-error');
    const loginButton = document.querySelector('#login');
    const servicesRoot = document.querySelector('#services');
    const permissionDetail = document.querySelector('#permission-detail');
    const globalLogout = document.querySelector('#global-logout');
    const selectedClientId = new URLSearchParams(location.search).get('client_id');

    function hideAllStates() {
      loggedOut.hidden = true;
      content.hidden = true;
      errorBox.hidden = true;
    }

    function setIdentity(user) {
      identity.textContent = user ? (user.display_name || user.id || 'NAKWOL ID') : '로그인하지 않음';
    }

    function showError(message) {
      hideAllStates();
      errorBox.textContent = message || '계정 정보를 불러오지 못했습니다.';
      errorBox.hidden = false;
    }

    function roleLabel(role) {
      if (role === 'admin') return '낙월 관리자';
      if (role === 'member') return '낙월 맹원';
      return '일반 사용자';
    }

    function showPermission(service) {
      while (permissionDetail.firstChild) permissionDetail.removeChild(permissionDetail.firstChild);
      permissionDetail.className = '';
      if (!service) {
        permissionDetail.className = 'permission-empty';
        permissionDetail.textContent = '연결된 서비스를 선택하면 이 서비스가 확인하는 AUTH 권한을 표시합니다.';
        return;
      }

      const title = document.createElement('strong');
      title.textContent = service.name || service.client_id;
      const list = document.createElement('ul');
      list.className = 'permissions-list';
      for (const permission of service.permissions || []) {
        const item = document.createElement('li');
        item.textContent = permission;
        list.appendChild(item);
      }
      permissionDetail.append(title, list);
    }

    function renderServices(services) {
      while (servicesRoot.firstChild) servicesRoot.removeChild(servicesRoot.firstChild);
      if (!services.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = '아직 표시할 연결 서비스 기록이 없습니다.';
        servicesRoot.appendChild(empty);
        showPermission(null);
        return;
      }

      let selected = services.find((service) => service.client_id === selectedClientId) || null;
      if (!selected && location.hash === '#permissions') selected = services[0];

      for (const service of services) {
        const item = document.createElement('article');
        item.className = 'service';
        item.dataset.selected = service === selected ? 'true' : 'false';

        const heading = document.createElement('div');
        heading.className = 'row';
        const name = document.createElement('strong');
        name.textContent = service.name || service.client_id;
        const choose = document.createElement('a');
        choose.href = '/account?client_id=' + encodeURIComponent(service.client_id) + '#permissions';
        choose.textContent = '서비스 권한 보기';
        heading.append(name, choose);

        const meta = document.createElement('div');
        meta.className = 'muted';
        meta.textContent = service.client_id;
        item.append(heading, meta);

        if (service.homepage_url) {
          const homepage = document.createElement('a');
          homepage.href = service.homepage_url;
          homepage.target = '_blank';
          homepage.rel = 'noopener noreferrer';
          homepage.textContent = '서비스 열기';
          item.appendChild(homepage);
        }
        servicesRoot.appendChild(item);
      }

      showPermission(selected);
      if (location.hash === '#permissions') document.querySelector('#permissions')?.scrollIntoView({ block: 'start' });
    }

    function renderAccount(summary) {
      const user = summary.user;
      setIdentity(user);
      document.querySelector('#profile-name').textContent = user.display_name || '-';
      document.querySelector('#profile-id').textContent = user.id || '-';
      document.querySelector('#membership-role').textContent = roleLabel(user.membership?.role);
      document.querySelector('#membership-state').textContent = user.membership?.is_member ? '인증됨' : '미인증';
      renderServices(Array.isArray(summary.services) ? summary.services : []);
      hideAllStates();
      content.hidden = false;
    }

    async function loadSummary() {
      const token = auth.getAccessToken();
      if (!token) return null;
      const response = await fetch('/account/api/summary', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (response.status === 401) {
        await auth.logout();
        return null;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error?.message || '계정 요약 정보를 불러오지 못했습니다.');
      }
      return payload.data;
    }

    loginButton.addEventListener('click', () => auth.login());
    globalLogout.addEventListener('click', async () => {
      if (!confirm('모든 낙월 서비스에서 로그아웃할까요?')) return;
      await auth.logout({ global: true, returnTo: location.origin + '/account' });
    });

    try {
      setIdentity(null);
      const user = await auth.bootstrap();
      if (!user) {
        hideAllStates();
        loggedOut.hidden = false;
      } else {
        const summary = await loadSummary();
        if (!summary) {
          setIdentity(null);
          hideAllStates();
          loggedOut.hidden = false;
        } else {
          renderAccount(summary);
        }
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  </script>
</body>
</html>`;
}

export function registerAccountRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/account', (c) => c.html(accountPageHtml()));

  app.get('/account/api/summary', async (c) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) return jsonError(c, 401, 'ACCOUNT_AUTH_REQUIRED', 'NAKWOL 계정 로그인이 필요합니다.');

    const userId = await authenticateAccessToken(c.env, token, ACCOUNT_CLIENT_ID);
    if (!userId) return jsonError(c, 401, 'INVALID_ACCOUNT_TOKEN', 'Account Center access token이 유효하지 않습니다.');

    const user = await getUserWithMembership(c.env, userId);
    if (!user) return jsonError(c, 404, 'ACCOUNT_USER_NOT_FOUND', 'NAKWOL 사용자를 찾을 수 없습니다.');

    const services = await listConnectedServices(c.env, userId);
    return c.json({ ok: true, data: { user, services } });
  });
}
