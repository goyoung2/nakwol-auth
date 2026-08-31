import type { Hono } from 'hono';
import type { Env } from './types';

export const LAB_CLIENT_ID = 'nakwol-auth-lab';

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
}
