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
  <title>NAKWOL 계정</title>
</head>
<body>
  <main id="account-root">
    <h1>NAKWOL 계정</h1>
    <p>계정 정보를 불러오는 중입니다.</p>
  </main>
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
