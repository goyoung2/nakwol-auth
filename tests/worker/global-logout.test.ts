import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('global logout can revoke every app access token owned by the central-session user', async () => {
  const store = await import('../../src/store');
  const revokeAccessTokensForUser = (store as typeof store & {
    revokeAccessTokensForUser?: (env: unknown, userId: string) => Promise<void>;
  }).revokeAccessTokensForUser;

  assert.equal(typeof revokeAccessTokensForUser, 'function');

  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return { run: async () => ({ success: true }) };
          },
        };
      },
    },
  };

  await revokeAccessTokensForUser!(env, 'usr_global_logout');

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE access_tokens SET revoked_at = \? WHERE user_id = \? AND revoked_at IS NULL/);
  assert.equal(calls[0].args[1], 'usr_global_logout');
});

test('session logout revokes all app tokens for that session user while local logout stays token-scoped', async () => {
  const source = await root('src/index.ts');
  const localStart = source.indexOf("app.post('/logout'");
  const globalStart = source.indexOf("app.get('/session/logout'");
  const globalEnd = source.indexOf('app.notFound', globalStart);

  assert.ok(localStart >= 0 && globalStart > localStart && globalEnd > globalStart);

  const localLogout = source.slice(localStart, globalStart);
  const globalLogout = source.slice(globalStart, globalEnd);

  assert.match(localLogout, /revokeAccessToken\(c\.env, token\)/);
  assert.doesNotMatch(localLogout, /revokeAccessTokensForUser/);

  assert.match(globalLogout, /findSessionUser\(c\.env, sid\)/);
  assert.match(globalLogout, /revokeAccessTokensForUser\(c\.env, sessionUserId\)/);
  assert.match(globalLogout, /deleteSession\(c\.env, sid\)/);

  const identify = globalLogout.indexOf('findSessionUser(c.env, sid)');
  const revoke = globalLogout.indexOf('revokeAccessTokensForUser(c.env, sessionUserId)');
  const removeSession = globalLogout.indexOf('deleteSession(c.env, sid)');
  assert.ok(identify >= 0 && identify < revoke && revoke < removeSession);
});
