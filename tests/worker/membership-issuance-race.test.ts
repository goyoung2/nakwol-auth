import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { authFixture } from '../helpers/auth-d1';
import { saveDiscordCredentials } from '../../src/discord-credentials';
import { createAuthorizationCode, createSession, upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { issueSiteCredential } from '../../src/site-credentials';
import { exchangeServerCode, refreshServerSession } from '../../src/server-sessions';
import type { Env } from '../../src/types';

function beforeBatch(env: Env, change: () => Promise<void>): Env {
  let pending = true;
  const DB = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        if (pending) { pending = false; await change(); }
        return target.batch(statements);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...env, DB };
}

async function setup() {
  const fixture = await authFixture();
  const env: Env = { ...fixture.env, DISCORD_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    DISCORD_CREDENTIAL_KEY_VERSION: '1' };
  await env.DB.prepare('UPDATE applications SET redirect_uris=? WHERE client_id=?')
    .bind(JSON.stringify(['https://a.test/__nakwol/callback']), 'a').run();
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  await saveDiscordCredentials(env, 'member', { accessToken: 'access', refreshToken: 'refresh',
    scope: 'identify guilds.members.read', expiresIn: 3600 });
  await env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('member',0)").run();
  const credential = await issueSiteCredential(env, 'member', 'a', 'https://a.test', 'fixture');
  const family = await createSession(env, 'member');
  const verifier = 'v'.repeat(43);
  const code = await createAuthorizationCode(env, 'member', 'a', 'https://a.test/__nakwol/callback',
    await sha256Base64Url(verifier), family.token);
  const binding = { clientId: 'a', siteOrigin: 'https://a.test', credential: credential.secret };
  const exchange = { ...binding, code, redirectUri: 'https://a.test/__nakwol/callback', codeVerifier: verifier };
  return { ...fixture, env, binding, exchange };
}

test('credential tombstone between role evaluation and server proof INSERT prevents issuance', async t => {
  const f = await setup(); t.after(f.dispose);
  const raced = beforeBatch(f.env, async () => {
    await f.env.DB.prepare("UPDATE discord_credentials SET state='reauth_required',generation=generation+1 WHERE user_id='member'").run();
  });
  await assert.rejects(exchangeServerCode(raced, f.exchange), /INVALID_CODE/);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM server_sessions').first<{n:number}>())?.n, 0);
});

test('role removal between evaluation and proof INSERT or refresh CAS prevents new proof', async t => {
  const f = await setup(); t.after(f.dispose);
  const issuanceRace = beforeBatch(f.env, async () => {
    await f.env.DB.prepare("UPDATE memberships SET role_ids='[]',role='user',status='inactive' WHERE user_id='member'").run();
  });
  await assert.rejects(exchangeServerCode(issuanceRace, f.exchange), /INVALID_CODE/);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM server_sessions').first<{n:number}>())?.n, 0);

  await upsertMembership(f.env, 'member', true, 'member', ['season3']);
  const issued = await exchangeServerCode(f.env, f.exchange);
  const refreshRace = beforeBatch(f.env, async () => {
    await f.env.DB.prepare("UPDATE memberships SET role_ids='[]',role='user',status='inactive' WHERE user_id='member'").run();
  });
  await assert.rejects(refreshServerSession(refreshRace, { ...f.binding, sessionId: issued.session.sessionId,
    handle: issued.handle, expectedGeneration: 0 }), /SESSION_EXPIRED|POLICY_CHANGED/);
  assert.equal((await f.env.DB.prepare('SELECT generation FROM server_sessions').first<{generation:number}>())?.generation, 0);
});
