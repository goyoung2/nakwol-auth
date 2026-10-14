import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/index';
import { createAuthFixture } from './auth-fixture';
import { sha256Base64Url } from '../../src/crypto';
import { createLoginCredentials, upsertMembership } from '../../src/store';

test('combined me snapshot preserves token, origin, revocation and app boundaries', async t => {
  const f = await createAuthFixture(); t.after(f.dispose);
  await upsertMembership(f.env, 'user', true, 'member', [f.env.NAKWOL_MEMBER_ROLE_ID || '']);
  const hash = await sha256Base64Url('fixture-token'), now = Date.now();
  await f.DB.prepare("INSERT INTO access_tokens VALUES (?, 'user', 'site', ?, NULL, ?)").bind(hash,now+60000,now).run();
  const me = (token = 'fixture-token', client = 'site', origin = 'https://site.test') => app.request('https://auth.test/me?client_id='+client, {headers:{Authorization:'Bearer '+token,Origin:origin}},f.env);
  assert.equal((await me()).status,200);
  assert.equal((await me('wrong')).status,401);
  assert.equal((await me('fixture-token','other')).status,403);
  assert.equal((await me('fixture-token','site','https://evil.test')).status,403);
  await f.DB.prepare('UPDATE access_tokens SET revoked_at=?').bind(now).run();
  assert.equal((await me()).status,401);
  await f.DB.prepare('UPDATE access_tokens SET revoked_at=NULL, expires_at=?').bind(now-1).run();
  assert.equal((await me()).status,401);
  await f.DB.prepare('UPDATE access_tokens SET expires_at=?').bind(now+60000).run();
  await f.DB.prepare("INSERT INTO user_reauthentication VALUES ('user',?,'user','fixture')").bind(now).run();
  assert.equal((await me()).status,401);
  await f.DB.prepare('DELETE FROM user_reauthentication').run();
  await f.DB.prepare("UPDATE users SET status='disabled'").run();
  assert.equal((await me()).status,403);
  await f.DB.prepare("UPDATE users SET status='active'").run();
  await f.DB.prepare("UPDATE applications SET status='disabled'").run();
  assert.equal((await me()).status,401);
});

test('batched callback credentials roll back together when session persistence fails', async t => {
  const f = await createAuthFixture(); t.after(f.dispose);
  const request = {id:'fixture-request',client_id:'site',redirect_uri:'https://site.test/',code_challenge:'challenge'};
  await f.DB.prepare("INSERT INTO oauth_requests(id,client_id,redirect_uri,code_challenge,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .bind(request.id,request.client_id,request.redirect_uri,request.code_challenge,Date.now()+60000,Date.now()).run();
  await f.DB.prepare("CREATE TRIGGER fail_session BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
  await assert.rejects(createLoginCredentials(f.env,'user',request));
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_codes').first())?.n,0);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM oauth_requests').first())?.n,1);
  await f.DB.prepare('DROP TRIGGER fail_session').run();
  const issued = await createLoginCredentials(f.env,'user',request);
  assert.ok(issued.code); assert.ok(issued.session.token);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_codes').first())?.n,1);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first())?.n,1);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM oauth_requests').first())?.n,0);
});
