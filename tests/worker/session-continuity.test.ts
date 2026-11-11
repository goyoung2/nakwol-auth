import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../../src/index';
import { createAuthFixture } from './auth-fixture';
import { createSession, findSessionUser, upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';

const DAY = 86400000;

test('service denial preserves central login and seven-day return visits', async t => {
  const f = await createAuthFixture();
  t.after(f.dispose);
  await upsertMembership(f.env, 'user', true, 'member', [f.env.NAKWOL_MEMBER_ROLE_ID || '']);
  await f.DB.prepare(`INSERT INTO applications VALUES ('restricted','Restricted','["https://restricted.test/"]','active',0,0)`).run();
  await f.DB.prepare(`INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('restricted','admin',0,0)`).run();
  const session = await createSession(f.env, 'user');
  const challenge = await sha256Base64Url('fixture-verifier');
  const authorize = (client = 'site', silent = true, cookie = session.token) => auth.request('https://auth.test/authorize?' + new URLSearchParams({
    client_id: client, redirect_uri: `https://${client}.test/`, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'state', ...(silent ? { prompt: 'none' } : {}),
  }), { headers: { Cookie: `nakwol_sid=${cookie}` } }, f.env);
  const expectSso = async () => {
    const response = await authorize();
    const location = new URL(response.headers.get('Location') || 'https://missing.test');
    assert.equal(location.origin, 'https://site.test');
    assert.equal(location.searchParams.get('error'), null);
    const code = location.searchParams.get('code');
    assert.ok(code, 'return visit must issue a code without Discord');
    const tokenResponse = await auth.request('https://auth.test/token?client_id=site', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: 'site', redirect_uri: 'https://site.test/', code_verifier: 'fixture-verifier' }),
    }, f.env);
    assert.equal(tokenResponse.status, 200);
    const token: { access_token: string } = await tokenResponse.json();
    const me = await auth.request('https://auth.test/me?client_id=site', {
      headers: { Origin: 'https://site.test', Authorization: `Bearer ${token.access_token}` },
    }, f.env);
    assert.equal(me.status, 200);
  };

  await t.test('A succeeds, B denies without credentials or cookie deletion, A succeeds again', async () => {
    await expectSso();
    const denied = await authorize('restricted');
    assert.equal(new URL(denied.headers.get('Location') || '').searchParams.get('error'), 'access_denied');
    assert.equal(denied.headers.get('Set-Cookie'), null);
    assert.equal(await findSessionUser(f.env, session.token), 'user');
    assert.equal((await f.DB.prepare(`SELECT COUNT(*) AS n FROM auth_codes WHERE client_id='restricted'`).first<{ n: number }>())?.n, 0);
    await expectSso();
  });

  await t.test('Discord callback denial also preserves the existing central login', async () => {
    const started = await authorize('restricted', false);
    const requestId = new URL(started.headers.get('Location') || '').searchParams.get('state');
    assert.ok(requestId);
    const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'fixture-discord-token' });
      if (url.endsWith('/users/@me')) return Response.json({ id: '1493410906456064113', username: 'Fixture' });
      if (url.endsWith('/member')) return Response.json({ roles: [f.env.NAKWOL_MEMBER_ROLE_ID] });
      throw new Error(`Unexpected external request: ${url}`);
    });
    try {
      const denied = await auth.request(`https://auth.test/auth/discord/callback?state=${requestId}&code=fixture`, {
        headers: { Cookie: `nakwol_sid=${session.token}` },
      }, f.env);
      assert.equal(new URL(denied.headers.get('Location') || '').searchParams.get('error'), 'access_denied');
      assert.equal(denied.headers.get('Set-Cookie'), null);
      assert.equal(await findSessionUser(f.env, session.token), 'user');
      await expectSso();
    } finally { mocked.mock.restore(); }
  });

  await t.test('revisits at 30 minutes, 2 hours, 1 day and just before 7 days need no Discord', async () => {
    for (const age of [1800000, 7200000, DAY, 3 * DAY, 7 * DAY - 60000]) {
      const verified = Date.now() - age;
      await f.DB.prepare('UPDATE memberships SET checked_at=?').bind(verified).run();
      await f.DB.prepare('UPDATE auth_sessions SET created_at=?,last_used_at=?,expires_at=?')
        .bind(verified, verified, verified + 10 * DAY).run();
      await expectSso();
    }
  });

  await t.test('7-day boundary requires refresh without deleting central login', async () => {
    await f.DB.prepare('UPDATE memberships SET checked_at=?').bind(Date.now() - 7 * DAY).run();
    const response = await authorize();
    assert.equal(new URL(response.headers.get('Location') || '').searchParams.get('error'), 'login_required');
    assert.equal(response.headers.get('Set-Cookie'), null);
  });

  await t.test('disabled users and invalid cookies cannot use the retained session', async () => {
    await upsertMembership(f.env, 'user', true, 'member', [f.env.NAKWOL_MEMBER_ROLE_ID || '']);
    await f.DB.prepare(`UPDATE users SET status='disabled' WHERE id='user'`).run();
    assert.equal(new URL((await authorize()).headers.get('Location') || '').searchParams.get('error'), 'access_denied');
    assert.equal(new URL((await authorize('site', true, 'invalid')).headers.get('Location') || '').searchParams.get('error'), 'login_required');
    await f.DB.prepare(`UPDATE users SET status='active' WHERE id='user'`).run();
    await expectSso();
  });
});
