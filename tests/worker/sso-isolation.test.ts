import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../../src/index';
import { createSession, findSessionUser, upsertMembership } from '../../src/store';
import { authFixture } from '../helpers/auth-d1';

test('B access denial preserves central identity and A SSO', async t => {
  const { env, dispose } = await authFixture(); t.after(dispose);
  await upsertMembership(env, 'member', true, 'member', ['season3']);
  await env.DB.prepare("INSERT INTO application_role_requirements VALUES ('b','[\"1553600098661957644\"]',0)").run();
  const session = await createSession(env, 'member');
  const authorize = (client: string) => auth.request('https://auth.test/authorize?' + new URLSearchParams({
    client_id: client, redirect_uri: `https://${client}.test/callback`, code_challenge: 'fixture-challenge',
    code_challenge_method: 'S256', prompt: 'none', state: 'client-state' }), { headers: { Cookie: `nakwol_sid=${session.token}` } }, env);
  const denied = await authorize('b');
  assert.equal(denied.status, 302);
  assert.equal(new URL(denied.headers.get('Location') ?? '').searchParams.get('error'), 'access_denied');
  assert.equal(denied.headers.get('Set-Cookie'), null);
  assert.equal(await findSessionUser(env, session.token), 'member');
  const allowed = await authorize('a');
  assert.ok(new URL(allowed.headers.get('Location') ?? '').searchParams.get('code'));
  await env.DB.prepare("UPDATE users SET status='disabled' WHERE id='member'").run();
  const invalid = await authorize('a');
  assert.match(invalid.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
  assert.equal(await findSessionUser(env, session.token), null);
});
