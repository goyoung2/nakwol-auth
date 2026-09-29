import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorizationCode, exchangeAuthorizationCode, upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { authFixture } from '../helpers/auth-d1';

test('20 concurrent exchanges consume a code once and issue exactly one token', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  const verifier = 'v'.repeat(43);
  const code = await createAuthorizationCode(env, 'member', 'a', 'https://a.test/callback', await sha256Base64Url(verifier));
  const args = { code, clientId: 'a', redirectUri: 'https://a.test/callback', codeVerifier: verifier };
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => exchangeAuthorizationCode(env, args)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM access_tokens').first<{ n: number }>())?.n, 1);
});

test('wrong PKCE or client does not consume a valid code', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  const verifier = 'v'.repeat(43);
  const code = await createAuthorizationCode(env, 'member', 'a', 'https://a.test/callback', await sha256Base64Url(verifier));
  const args = { code, clientId: 'a', redirectUri: 'https://a.test/callback', codeVerifier: verifier };
  await assert.rejects(exchangeAuthorizationCode(env, { ...args, codeVerifier: 'invalid' }), /PKCE/);
  await assert.rejects(exchangeAuthorizationCode(env, { ...args, clientId: 'b' }), /MISMATCH/);
  assert.ok((await exchangeAuthorizationCode(env, args)).accessToken);
});

test('failed consume rolls back token issuance in the D1 batch', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  const verifier = 'v'.repeat(43);
  const code = await createAuthorizationCode(env, 'member', 'a', 'https://a.test/callback', await sha256Base64Url(verifier));
  const args = { code, clientId: 'a', redirectUri: 'https://a.test/callback', codeVerifier: verifier };
  await env.DB.prepare("CREATE TRIGGER fail_consume BEFORE UPDATE ON auth_codes BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
  await assert.rejects(exchangeAuthorizationCode(env, args), /fixture failure/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM access_tokens').first<{ n: number }>())?.n, 0);
  assert.equal((await env.DB.prepare('SELECT used_at FROM auth_codes').first<{ used_at: number | null }>())?.used_at, null);
  await env.DB.prepare('DROP TRIGGER fail_consume').run();
  assert.ok((await exchangeAuthorizationCode(env, args)).accessToken);
});
