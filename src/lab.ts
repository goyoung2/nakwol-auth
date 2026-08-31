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
  <title>NAKWOL AUTH LAB</title>
</head>
<body>
  <main id="lab-root">
    <h1>NAKWOL AUTH LAB</h1>
    <p>AUTH 검증 환경을 준비하는 중입니다.</p>
  </main>
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
