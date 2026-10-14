import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { createAuthFixture } from './auth-fixture';
import { registerConnectCliAppRoutes } from '../../src/connect-cli-apps';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

test('SQLite prevents both competing qualification and base-policy write orders', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const dir = new URL('../../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
    db.exec("INSERT INTO applications VALUES('site','Site','[]','active',0,0),('other','Other','[]','active',0,0)");
    db.exec("INSERT INTO application_qualification_requirements VALUES('site','any','[\"q\"]',0)");
    assert.throws(() => db.exec("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','guest',0,0)"), /CUSTOM_QUALIFICATIONS_ACTIVE/);
    db.exec("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','member',0,0),('other','guest',0,0)");
    assert.throws(() => db.exec("UPDATE application_settings SET access_policy='guest' WHERE client_id='site'"), /CUSTOM_QUALIFICATIONS_ACTIVE/);
    assert.throws(() => db.exec("UPDATE application_qualification_requirements SET client_id='other' WHERE client_id='site'"), /MEMBER_POLICY_REQUIRED/);
    db.exec("DELETE FROM application_qualification_requirements WHERE client_id='site'; UPDATE application_settings SET access_policy='guest' WHERE client_id='site'");
    assert.throws(() => db.exec("INSERT INTO application_qualification_requirements VALUES('site','any','[\"q\"]',0)"), /MEMBER_POLICY_REQUIRED/);
    assert.equal(db.prepare("SELECT access_policy FROM application_settings WHERE client_id='site'").get()?.access_policy, 'guest');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM application_qualification_requirements").get()?.n, 0);
  } finally { db.close(); }
});

test('CLI policy PATCH returns 409 for custom qualifications and allows update after restoring legacy', async t => {
  const f = await createAuthFixture();
  t.after(f.dispose);
  await f.DB.prepare("INSERT INTO auth_operators(user_id,role,created_at) VALUES('user','operator',0)").run();
  await f.DB.prepare("INSERT INTO connect_cli_tokens VALUES(?,'user','[\"connect:apps\"]',?,NULL,0,0)").bind(await sha256Base64Url('cli'), Date.now() + 60000).run();
  await f.DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','member',0,0)").run();
  await f.DB.prepare("INSERT INTO application_qualification_requirements VALUES('site','any','[\"q\"]',0)").run();
  const app = new Hono<{ Bindings: Env }>();
  registerConnectCliAppRoutes(app);
  const patch = (env = f.env) => app.request('https://auth.test/connect/cli/apps/site', { method: 'PATCH', headers: { Authorization: 'Bearer cli', 'Content-Type': 'application/json' }, body: JSON.stringify({ access_policy: 'guest', name: 'Changed' }) }, env);
  const denied = await patch();
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).error.code, 'CUSTOM_QUALIFICATIONS_ACTIVE');
  assert.equal((await f.DB.prepare("SELECT name FROM applications WHERE client_id='site'").first())?.name, 'Fixture');
  await f.DB.prepare("DELETE FROM application_qualification_requirements WHERE client_id='site'").run();
  const racingEnv: Env = { ...f.env, DB: new Proxy(f.DB, {
    get(target, property, receiver) {
      if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
        await target.prepare("INSERT INTO application_qualification_requirements VALUES('site','any','[\"q\"]',0)").run();
        return target.batch(statements);
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) };
  assert.equal((await patch(racingEnv)).status, 409);
  assert.equal((await f.DB.prepare("SELECT name FROM applications WHERE client_id='site'").first())?.name, 'Fixture');
  await f.DB.prepare("DELETE FROM application_qualification_requirements WHERE client_id='site'").run();
  assert.equal((await patch()).status, 200);
});
