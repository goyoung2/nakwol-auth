import type { Context, Hono } from 'hono';
import devicePageSource from './assets/nakwol-connect-device.js.txt';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import {
  approveDeviceGrant,
  authenticateCliToken,
  createDeviceGrant,
  denyDeviceGrant,
  exchangeDeviceGrant,
} from './connect-cli-store';
import type { Env } from './types';

const DEVICE_CLIENT_ID = 'nakwol-connect-cli';

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

function deviceVerificationPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NAKWOL Connect CLI 승인</title>
  <style>
    :root{font-family:Inter,Pretendard,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e5e7eb;background:#080c14}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#1e2846 0,#080c14 40%)}
    main{width:min(620px,calc(100% - 32px));background:#111827;border:1px solid #2b3950;border-radius:20px;padding:30px;box-shadow:0 30px 90px rgba(0,0,0,.35)}
    .brand{color:#a5b4fc;font-size:13px;font-weight:800;letter-spacing:.04em}h1{font-size:26px;margin:8px 0 10px}p{color:#94a3b8;line-height:1.6}
    .code{margin:22px 0;background:#050912;border:1px solid #28354a;border-radius:14px;padding:18px;text-align:center;font:800 28px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:#c7d2fe}
    #device-status{padding:13px 14px;background:#0c1321;border-radius:12px;color:#cbd5e1}#device-status[data-bad="true"]{color:#fecaca;border:1px solid #7f1d1d}
    .actions{display:flex;gap:10px;margin-top:18px}button{border:0;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}.primary{background:#6366f1;color:white}.ghost{background:#273349;color:#e5e7eb}button:disabled{opacity:.5}
    small{display:block;margin-top:18px;color:#64748b;line-height:1.5}
  </style>
</head>
<body>
<main>
  <div class="brand">落月 · NAKWOL Connect</div>
  <h1>CLI 연결 승인</h1>
  <p>현재 PC의 NAKWOL Connect CLI가 앱 등록/설정을 요청했습니다. 아래 코드가 CLI 화면과 같은지 확인하세요.</p>
  <div id="device-code" class="code">-</div>
  <div id="device-status">로그인 상태를 확인하고 있습니다.</div>
  <div class="actions"><button id="device-login" class="primary" type="button" hidden>NAKWOL ID로 로그인</button></div>
  <div id="device-actions" class="actions" hidden>
    <button id="device-approve" class="primary" type="button">이 CLI 연결 허용</button>
    <button id="device-deny" class="ghost" type="button">거절</button>
  </div>
  <small>승인하면 CLI는 NAKWOL Connect 앱 관리 권한만 받습니다. Discord Client Secret이나 Cloudflare 계정 권한은 CLI에 전달되지 않습니다.</small>
</main>
<script type="module" src="/connect/cli/device.js"></script>
</body>
</html>`;
}

async function browserUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const token = bearer(c);
  if (!token) return null;
  return authenticateAccessToken(c.env, token, DEVICE_CLIENT_ID);
}

export function registerConnectCliRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/connect/cli/device/start', async (c) => {
    let body: { scopes?: unknown } = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const grant = await createDeviceGrant(c.env, body.scopes);
    return c.json({
      ok: true,
      device_code: grant.deviceCode,
      user_code: grant.userCode,
      verification_uri: grant.verificationUri,
      verification_uri_complete: grant.verificationUriComplete,
      expires_in: grant.expiresIn,
      interval: grant.interval,
    });
  });

  app.get('/connect/cli/device/verify', (c) => c.html(deviceVerificationPage()));

  app.get('/connect/cli/device.js', () => new Response(devicePageSource, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  }));

  app.post('/connect/cli/device/approve', async (c) => {
    const userId = await browserUserId(c);
    if (!userId) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'NAKWOL ID 로그인이 필요합니다.' } }, 401);
    const body = await c.req.json<{ user_code?: string }>().catch(() => ({}));
    const userCode = String(body.user_code || '').trim().toUpperCase();
    if (!userCode) return c.json({ ok: false, error: { code: 'USER_CODE_REQUIRED', message: '승인 코드가 필요합니다.' } }, 400);
    const result = await approveDeviceGrant(c.env, userCode, userId);
    if (!result.ok) {
      const status = result.code === 'DEVELOPER_PERMISSION_REQUIRED' ? 403 : 400;
      return c.json({ ok: false, error: { code: result.code, message: result.code === 'DEVELOPER_PERMISSION_REQUIRED' ? 'NAKWOL Connect 개발자 권한이 필요합니다.' : 'CLI 연결 요청을 승인할 수 없습니다.' } }, status);
    }
    await logAuthEvent(c.env, 'connect.cli.device.approved', userId, DEVICE_CLIENT_ID, { user_code: userCode });
    return c.json({ ok: true });
  });

  app.post('/connect/cli/device/deny', async (c) => {
    const userId = await browserUserId(c);
    if (!userId) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'NAKWOL ID 로그인이 필요합니다.' } }, 401);
    const body = await c.req.json<{ user_code?: string }>().catch(() => ({}));
    const userCode = String(body.user_code || '').trim().toUpperCase();
    if (!userCode) return c.json({ ok: false, error: { code: 'USER_CODE_REQUIRED', message: '승인 코드가 필요합니다.' } }, 400);
    const result = await denyDeviceGrant(c.env, userCode, userId);
    if (!result.ok) return c.json({ ok: false, error: { code: result.code, message: 'CLI 연결 요청을 거절할 수 없습니다.' } }, 400);
    await logAuthEvent(c.env, 'connect.cli.device.denied', userId, DEVICE_CLIENT_ID, { user_code: userCode });
    return c.json({ ok: true });
  });

  app.post('/connect/cli/device/token', async (c) => {
    const body = await c.req.json<{ device_code?: string }>().catch(() => ({}));
    const deviceCode = String(body.device_code || '');
    if (!deviceCode) return c.json({ ok: false, error: 'invalid_request' }, 400);
    const result = await exchangeDeviceGrant(c.env, deviceCode);
    if (result.status === 'approved') {
      return c.json({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        scope: 'connect:apps',
      });
    }
    if (result.status === 'pending') return c.json({ ok: false, error: 'authorization_pending' }, 428);
    if (result.status === 'denied') return c.json({ ok: false, error: 'access_denied' }, 403);
    if (result.status === 'expired') return c.json({ ok: false, error: 'expired_token' }, 400);
    if (result.status === 'consumed') return c.json({ ok: false, error: 'invalid_grant' }, 400);
    return c.json({ ok: false, error: 'invalid_device_code' }, 400);
  });

  app.get('/connect/cli/me', async (c) => {
    const token = bearer(c);
    if (!token) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'CLI token이 필요합니다.' } }, 401);
    const principal = await authenticateCliToken(c.env, token);
    if (!principal) return c.json({ ok: false, error: { code: 'INVALID_CLI_TOKEN', message: 'CLI token이 만료되었거나 취소되었습니다.' } }, 401);
    const user = await getUserWithMembership(c.env, principal.userId);
    return c.json({
      ok: true,
      data: {
        user,
        connect: {
          is_operator: principal.isOperator,
          developer_role: principal.developerRole,
          scopes: principal.scopes,
        },
      },
    });
  });
}
