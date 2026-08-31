import type { Hono } from 'hono';
import type { Env } from './types';

export const ACCOUNT_CLIENT_ID = 'nakwol-account-center';

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
}
