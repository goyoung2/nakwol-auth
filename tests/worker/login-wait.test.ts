import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { loginWait } from '../../src/login-wait';
import type { Env } from '../../src/types';

function fixture() {
  const app = new Hono<{Bindings: Env}>();
  let calls = 0;
  app.use('/auth/discord/callback', loginWait);
  app.get('/auth/discord/callback', c => {
    calls++;
    if (c.req.query('fail')) return c.json({ error: 'EXPIRED_LOGIN_REQUEST' }, 400);
    c.header('Set-Cookie', 'nakwol_sid=fixture; HttpOnly; Secure; SameSite=Lax');
    return c.redirect('https://site.test/?code=one-use&state=state');
  });
  return {app, calls: () => calls};
}

test('browser callback paints a private, self-contained waiting page before any OAuth work', async () => {
  const {app, calls} = fixture();
  const response = await app.request('/auth/discord/callback?code=private-code&state=private-state', {headers:{Accept:'text/html'}});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<progress aria-label="로그인 확인 중"><\/progress>/);
  assert.match(html, /history.replaceState/);
  assert.doesNotMatch(html, /private-code|private-state|<script src|<link /);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(response.headers.get('Content-Security-Policy') || '', /connect-src 'self'/);
  assert.equal(calls(), 0);
});

test('completion returns registered destination and preserves secure session cookie without following redirect', async () => {
  const {app, calls} = fixture();
  const response = await app.request('/auth/discord/callback?code=fixture&state=fixture', {headers:{Accept:'application/json','X-Nakwol-Login-Wait':'1'}});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {location:'https://site.test/?code=one-use&state=state'});
  assert.match(response.headers.get('Set-Cookie') || '', /HttpOnly; Secure/);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls(), 1);
});

test('failed verification stays failed and nonbrowser callback keeps existing redirect contract', async () => {
  const {app} = fixture();
  const failed = await app.request('/auth/discord/callback?fail=1', {headers:{'X-Nakwol-Login-Wait':'1'}});
  assert.equal(failed.status, 400);
  assert.equal(failed.headers.get('Set-Cookie'), null);
  const legacy = await app.request('/auth/discord/callback');
  assert.equal(legacy.status, 302);
});
