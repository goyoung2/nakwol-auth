import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../../src/index';
import { authFixture } from '../helpers/auth-d1';

test('Discord callback is bound to its initiating browser and consumed only once', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  t.mock.method(Math, 'random', () => 1);
  const begin = () => auth.request('https://auth.test/authorize?' + new URLSearchParams({
    client_id: 'a', redirect_uri: 'https://a.test/callback', code_challenge: 'fixture-challenge',
    code_challenge_method: 'S256', state: 'client-state' }), {}, env);
  const start = await begin();
  const state = new URL(start.headers.get('Location') ?? '').searchParams.get('state');
  assert.ok(state);
  const callback = 'https://auth.test/auth/discord/callback?' + new URLSearchParams({ state, error: 'access_denied' });
  const foreign = await auth.request(callback, {}, env);
  assert.equal(foreign.status, 400, 'a different browser cannot consume the transaction');
  const cookie = start.headers.get('Set-Cookie');
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  const headers = { Cookie: cookie.split(';')[0] };
  const results = await Promise.all(Array.from({ length: 20 }, () => auth.request(callback, { headers }, env)));
  assert.equal(results.filter(r => r.status === 302).length, 1);
  assert.equal(results.filter(r => r.status === 400).length, 19);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>())?.n, 0);
});

test('parallel tabs keep independent transactions; sequential sixth start is bounded', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  t.mock.method(Math, 'random', () => 1);
  const cookies: string[] = [];
  const states: string[] = [];
  const url = 'https://auth.test/authorize?' + new URLSearchParams({ client_id: 'a', redirect_uri: 'https://a.test/callback',
    code_challenge: 'fixture-challenge', code_challenge_method: 'S256' });
  for (let i = 0; i < 5; i++) {
    const res = await auth.request(url, { headers: { Cookie: cookies.join('; ') } }, env);
    assert.equal(res.status, 302);
    const cookie = res.headers.get('Set-Cookie'); assert.ok(cookie);
    const state = new URL(res.headers.get('Location') ?? '').searchParams.get('state'); assert.ok(state);
    cookies.push(cookie.split(';')[0]); states.push(state);
  }
  assert.equal((await auth.request(url, { headers: { Cookie: cookies.join('; ') } }, env)).status, 429);
  const responses = await Promise.all(states.slice(0, 2).map(state => auth.request(
    'https://auth.test/auth/discord/callback?' + new URLSearchParams({ state, error: 'access_denied' }),
    { headers: { Cookie: cookies.join('; ') } }, env)));
  assert.deepEqual(responses.map(res => res.status), [302, 302]);
  await env.DB.prepare('UPDATE oauth_requests SET expires_at=0 WHERE id=?').bind(states[2]).run();
  assert.equal((await auth.request('https://auth.test/auth/discord/callback?' + new URLSearchParams({ state: states[2], error: 'access_denied' }),
    { headers: { Cookie: cookies.join('; ') } }, env)).status, 400);
});
