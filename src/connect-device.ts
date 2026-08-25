import type { Hono } from 'hono';
import { randomToken, sha256Base64Url } from './crypto';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import { canUseCli, type ConnectRole } from './connect-permissions';
import {
  createUserCode,
  deviceEffectiveStatus,
  isDeviceRequestConsumable,
  type DeviceStateRow,
} from './connect-device-core';
import type { Env } from './types';
import devicePageSource from './assets/nakwol-connect-device.js.txt';

const ADMIN_CLIENT_ID = 'nakwol-connect-admin';
const DEVICE_TTL_MS = 10 * 60 * 1000;
const CLI_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function bearerToken(header: string | undefined): string | null {
  const match = (header || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function connectRole(env: Env, userId: string): Promise<ConnectRole> {
  const row = await env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id = ?`).bind(userId).first<{ role: string }>();
  if (row?.role === 'owner' || row?.role === 'operator' || row?.role === 'developer') return row.role;
  return null;
}

async function approverIdentity(env: Env, authorization: string | undefined) {
  const token = bearerToken(authorization);
  if (!token) return null;
  const userId = await authenticateAccessToken(env, token, ADMIN_CLIENT_ID);
  if (!userId) return null;
  const user = await getUserWithMembership(env, userId);
  if (!user) return null;
  const role = await connectRole(env, userId);
  if (!canUseCli(role, user.membership?.role)) return { userId, user, role, allowed: false as const };
  return { userId, user, role, allowed: true as const };
}

function normalizeUserCode(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function jsonError(c: any, status: number, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status);
}

export function registerConnectDeviceRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/device', (c) => c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NAKWOL Connect CLI 승인</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#e5e7eb;background:#080c14}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#182038,#080c14 42%)}main{width:min(620px,calc(100% - 28px));background:#111827;border:1px solid #293548;border-radius:18px;padding:28px;box-sizing:border-box}h1{margin:0 0 8px}p{color:#aab5c5;line-height:1.6}.code{font:700 28px ui-monospace,Consolas,monospace;letter-spacing:.08em;background:#050912;border:1px solid #334155;border-radius:12px;padding:16px;text-align:center;margin:18px 0}.row{display:flex;gap:10px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:11px 15px;font-weight:750;cursor:pointer}.primary{background:#6366f1;color:#fff}.danger{background:#3f1d28;color:#fecdd3}.muted{font-size:12px;color:#8b9aaf}.ok{color:#86efac}.bad{color:#fca5a5}</style></head>
<body><main><div class="muted">落月 · NAKWOL Connect</div><h1>CLI 접근 승인</h1><p>로컬 코딩 에이전트가 NAKWOL Connect 앱을 등록·관리하려고 합니다. 이 페이지는 Cloudflare 키나 Discord 비밀키를 CLI에 전달하지 않습니다.</p><div id="user-code" class="code">----</div><div id="status">로그인 상태 확인 중…</div><div class="row" style="margin-top:18px"><button id="login" class="primary" hidden>낙월 로그인</button><button id="approve" class="primary" hidden>이 CLI 허용</button><button id="deny" class="danger" hidden>거부</button></div></main><script type="module" src="/connect/device/app.js"></script></body></html>`));

  app.get('/connect/device/app.js', () => new Response(devicePageSource, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  }));

  app.post('/connect/api/device/start', async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    const deviceCode = randomToken(32);
    const deviceHash = await sha256Base64Url(deviceCode);
    const now = Date.now();
    let userCode = '';
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      userCode = createUserCode();
      try {
        await c.env.DB.prepare(
          `INSERT INTO connect_device_requests(device_code_hash,user_code,status,requested_action,project_name,framework,homepage_url,approved_user_id,expires_at,created_at,approved_at,consumed_at)
           VALUES (?,?,'pending','cli_login',?,?,?,?,?,?,NULL,NULL,NULL)`
        ).bind(
          deviceHash,
          userCode,
          typeof body.project_name === 'string' ? body.project_name.slice(0, 120) : null,
          typeof body.framework === 'string' ? body.framework.slice(0, 40) : null,
          typeof body.homepage_url === 'string' ? body.homepage_url.slice(0, 500) : null,
          null,
          now + DEVICE_TTL_MS,
          now,
        ).run();
        inserted = true;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    const origin = new URL(c.req.url).origin;
    return c.json({ ok: true, data: {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${origin}/connect/device`,
      verification_uri_complete: `${origin}/connect/device?user_code=${encodeURIComponent(userCode)}`,
      expires_in: Math.floor(DEVICE_TTL_MS / 1000),
      interval: 2,
    } }, 201);
  });

  app.post('/connect/api/device/poll', async (c) => {
    const body = await c.req.json().catch(() => ({} as any));
    const rawCode = typeof body.device_code === 'string' ? body.device_code : '';
    if (!rawCode) return jsonError(c, 400, 'DEVICE_CODE_REQUIRED', 'device_code가 필요합니다.');
    const hash = await sha256Base64Url(rawCode);
    const row = await c.env.DB.prepare(
      `SELECT device_code_hash,user_code,status,approved_user_id,expires_at,consumed_at FROM connect_device_requests WHERE device_code_hash = ?`
    ).bind(hash).first<any>();
    if (!row) return jsonError(c, 404, 'DEVICE_NOT_FOUND', 'device 요청을 찾을 수 없습니다.');
    const status = deviceEffectiveStatus(row);
    if (status === 'pending') return c.json({ ok: true, data: { status: 'pending', interval: 2 } });
    if (status === 'denied') return jsonError(c, 403, 'DEVICE_DENIED', 'CLI 접근 요청이 거부되었습니다.');
    if (status === 'expired') return jsonError(c, 410, 'DEVICE_EXPIRED', 'CLI 접근 요청이 만료되었습니다.');
    if (status === 'consumed') return jsonError(c, 410, 'DEVICE_CONSUMED', '이미 사용된 device 요청입니다.');
    if (!row.approved_user_id || !isDeviceRequestConsumable(row)) return jsonError(c, 409, 'DEVICE_NOT_APPROVED', '승인 상태를 확인할 수 없습니다.');

    const now = Date.now();
    const consumed = await c.env.DB.prepare(
      `UPDATE connect_device_requests SET status='consumed', consumed_at=?
        WHERE device_code_hash=? AND status='approved' AND consumed_at IS NULL AND expires_at > ?`
    ).bind(now, hash, now).run();
    if (Number(consumed.meta?.changes ?? 0) !== 1) return jsonError(c, 409, 'DEVICE_CONSUMED', '다른 요청에서 이미 device 승인을 사용했습니다.');

    const rawToken = randomToken(32);
    const tokenHash = await sha256Base64Url(rawToken);
    const expiresAt = now + CLI_TOKEN_TTL_MS;
    await c.env.DB.prepare(
      `INSERT INTO connect_cli_tokens(token_hash,user_id,expires_at,revoked_at,created_at,last_used_at,label)
       VALUES (?,?,?,NULL,?,?,?)`
    ).bind(tokenHash, row.approved_user_id, expiresAt, now, now, 'NAKWOL Connect CLI').run();
    await logAuthEvent(c.env, 'connect.cli.login', row.approved_user_id, ADMIN_CLIENT_ID);
    return c.json({ ok: true, data: { status: 'approved', access_token: rawToken, token_type: 'Bearer', expires_in: Math.floor(CLI_TOKEN_TTL_MS / 1000) } });
  });

  app.post('/connect/api/device/approve', async (c) => {
    const identity = await approverIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return jsonError(c, 401, 'UNAUTHORIZED', 'NAKWOL 로그인이 필요합니다.');
    if (!identity.allowed) return jsonError(c, 403, 'DEVELOPER_ROLE_REQUIRED', 'NAKWOL Connect 개발자 권한이 필요합니다.');
    const body = await c.req.json().catch(() => ({} as any));
    const userCode = normalizeUserCode(body.user_code);
    if (!userCode) return jsonError(c, 400, 'USER_CODE_REQUIRED', 'user_code가 필요합니다.');
    const row = await c.env.DB.prepare(
      `SELECT status,expires_at,consumed_at FROM connect_device_requests WHERE user_code=?`
    ).bind(userCode).first<DeviceStateRow>();
    if (!row) return jsonError(c, 404, 'DEVICE_NOT_FOUND', '승인 요청을 찾을 수 없습니다.');
    const status = deviceEffectiveStatus(row);
    if (status === 'expired') return jsonError(c, 410, 'DEVICE_EXPIRED', '승인 요청이 만료되었습니다.');
    if (status !== 'pending') return jsonError(c, 409, 'DEVICE_NOT_PENDING', '이미 처리된 승인 요청입니다.');
    await c.env.DB.prepare(
      `UPDATE connect_device_requests SET status='approved',approved_user_id=?,approved_at=? WHERE user_code=? AND status='pending'`
    ).bind(identity.userId, Date.now(), userCode).run();
    await logAuthEvent(c.env, 'connect.cli.device.approved', identity.userId, ADMIN_CLIENT_ID, { user_code: userCode });
    return c.json({ ok: true, data: { status: 'approved', user_code: userCode } });
  });

  app.post('/connect/api/device/deny', async (c) => {
    const identity = await approverIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return jsonError(c, 401, 'UNAUTHORIZED', 'NAKWOL 로그인이 필요합니다.');
    if (!identity.allowed) return jsonError(c, 403, 'DEVELOPER_ROLE_REQUIRED', 'NAKWOL Connect 개발자 권한이 필요합니다.');
    const body = await c.req.json().catch(() => ({} as any));
    const userCode = normalizeUserCode(body.user_code);
    const result = await c.env.DB.prepare(
      `UPDATE connect_device_requests SET status='denied' WHERE user_code=? AND status='pending' AND expires_at>?`
    ).bind(userCode, Date.now()).run();
    if (Number(result.meta?.changes ?? 0) !== 1) return jsonError(c, 409, 'DEVICE_NOT_PENDING', '대기 중인 요청이 아닙니다.');
    await logAuthEvent(c.env, 'connect.cli.device.denied', identity.userId, ADMIN_CLIENT_ID, { user_code: userCode });
    return c.json({ ok: true, data: { status: 'denied', user_code: userCode } });
  });
}
