import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from '../helpers/auth-d1';
import { evaluateAccess, MEMBERSHIP_MAX_AGE_MS } from '../../src/policy';
import { createAuthorizationCode, exchangeAuthorizationCode, inspectAccessToken, upsertMembership } from '../../src/store';
import { saveAuthPolicy } from '../../src/auth-policy-settings';
import { sha256Base64Url } from '../../src/crypto';

test('source-aware authorization bounds only the entitlement used and explicit denial wins', async t => {
  const { env, dispose } = await authFixture();
  t.after(dispose);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO auth_identities VALUES ('i','member','discord','1553600098661957644',0,0)").run();
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  await env.DB.prepare('UPDATE memberships SET checked_at=?').bind(now).run();
  await env.DB.prepare(`INSERT INTO application_access_grants(client_id,discord_user_id,status,reason,updated_by,updated_at,expires_at)
    VALUES ('a','1553600098661957644','active','support','member',?,?)`).bind(now, now + 60000).run();
  const member = await evaluateAccess(env, 'member', 'a', { now });
  assert.equal(member.source, 'role');
  assert.ok(member.validUntil > now + 60000);
  await env.DB.prepare('UPDATE memberships SET checked_at=?').bind(now - MEMBERSHIP_MAX_AGE_MS).run();
  const grant = await evaluateAccess(env, 'member', 'a', { now });
  assert.equal(grant.source, 'manual-grant');
  assert.equal(grant.validUntil, now + 60000);
  assert.equal((await evaluateAccess(env, 'member', 'a', { now: now + 60000 })).allowed, false);
  await env.DB.prepare(`INSERT INTO application_access_denies(scope,discord_user_id,status,reason,updated_by,updated_at)
    VALUES ('app:a','1553600098661957644','active','blocked','member',?)`).bind(now).run();
  assert.equal((await evaluateAccess(env, 'member', 'a', { now })).reason, 'APPLICATION_ACCESS_DENIED');
  await env.DB.prepare("UPDATE application_access_denies SET scope='global'").run();
  assert.equal((await evaluateAccess(env, 'member', 'b', { now })).reason, 'GLOBAL_ACCESS_DENIED');
  await env.DB.prepare('DELETE FROM application_access_denies').run();
  await env.DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('a','admin',0,0)").run();
  assert.equal((await evaluateAccess(env, 'member', 'a', { now })).allowed, false);
  await env.DB.prepare("UPDATE application_settings SET access_policy='guest'").run();
  const guest = await evaluateAccess(env, 'member', 'a', { now, expiresAt: now + 10000 });
  assert.equal(guest.source, 'guest');
  assert.equal(guest.validUntil, now + 10000);
  await env.DB.prepare("UPDATE users SET status='disabled' WHERE id='member'").run();
  assert.equal((await evaluateAccess(env, 'member', 'a', { now })).reason, 'USER_DISABLED');
});

test('existing token original expiry is never extended by policy defaults', async t => {
  const { env, dispose } = await authFixture();
  t.after(dispose);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO access_tokens VALUES (?, 'member','a',?,NULL,?)")
    .bind(await sha256Base64Url('short-token'), now + 10000, now).run();
  assert.equal((await inspectAccessToken(env, 'short-token', 'a'))?.expiresAt, now + 10000);
  assert.equal(await inspectAccessToken(env, 'short-token', 'b'), null);
  await env.DB.prepare('UPDATE access_tokens SET expires_at=?').bind(now - 1).run();
  assert.equal(await inspectAccessToken(env, 'short-token', 'a'), null);
});


test('shortening token TTL is durable and relaxation cannot resurrect an expired token', async t => {
  const { env, dispose } = await authFixture();
  t.after(dispose);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES ('member',0)").run();
  await env.DB.prepare("INSERT INTO access_tokens VALUES (?, 'member','a',?,NULL,?)")
    .bind(await sha256Base64Url('policy-token'), now + 3600000, now - 700000).run();
  const shortened = await saveAuthPolicy(env, {actor: 'member', clientId: 'a', expectedVersion: 0, patch: {accessTokenSeconds: 600}, reason: 'shorten'});
  assert.equal(await inspectAccessToken(env, 'policy-token', 'a'), null);
  await saveAuthPolicy(env, {actor: 'member', clientId: 'a', expectedVersion: shortened.policyVersion, patch: {accessTokenSeconds: 3600}, reason: 'relax'});
  assert.equal(await inspectAccessToken(env, 'policy-token', 'a'), null);
});


test('token mint observes policy shortening committed just before the issuance transaction', async t => {
  const { env, dispose } = await authFixture();
  t.after(dispose);
  await env.DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES ('member',0)").run();
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  const code = await createAuthorizationCode(env, 'member', 'a', 'https://a.test/callback', await sha256Base64Url('verifier'));
  const originalBatch = env.DB.batch.bind(env.DB);
  let intercept = true;
  let version = 0;
  const racedEnv = { ...env, DB: new Proxy(env.DB, { get(target, property) {
    if (property !== 'batch') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
    return async (statements: D1PreparedStatement[]) => {
    if (intercept) {
      intercept = false;
      const shortened = await saveAuthPolicy(env, { actor: 'member', clientId: 'a', expectedVersion: 0,
        patch: { accessTokenSeconds: 600 }, reason: 'race shortening' });
      version = shortened.policyVersion;
    }
    return originalBatch(statements);
    };
  } }) };
  const token = await exchangeAuthorizationCode(racedEnv, { code, clientId: 'a', redirectUri: 'https://a.test/callback', codeVerifier: 'verifier' });
  assert.equal(token.expiresIn, 600);
  const issued = await inspectAccessToken(env, token.accessToken, 'a');
  assert.ok(issued);
  assert.equal(issued.expiresAt - issued.createdAt, 600000);
  await saveAuthPolicy(env, { actor: 'member', clientId: 'a', expectedVersion: version,
    patch: { accessTokenSeconds: 3600 }, reason: 'later relaxation' });
  assert.equal((await inspectAccessToken(env, token.accessToken, 'a'))?.expiresAt, issued.expiresAt);
});
