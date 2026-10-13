import { migrationStatements } from './migration-statements';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import app from '../../src/index';
import { diagnoseApplicationAccess, MEMBERSHIP_MAX_AGE_MS } from '../../src/policy';
import { parseQualificationIds, parseQualificationMatchMode } from '../../src/qualifications';
import { sha256Base64Url } from '../../src/crypto';
import { upsertMembership } from '../../src/store';

const season = '1553600098661957643';
const first = '1493413577489649715';
const second = '1519965362827956315';
const guild = '1493410906456064112';

test('qualification selection rejects empty and malformed input', () => {
  for (const value of [[], null, [''], ['id with spaces'], Array(33).fill('q')]) assert.throws(() => parseQualificationIds(value));
  assert.deepEqual(parseQualificationIds(['q1', 'q1']), ['q1']);
  assert.throws(() => parseQualificationMatchMode('either'));
});

test('named qualifications gate application access using the existing membership snapshot', async (t) => {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql', '0016_membership_qualifications.sql']) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of migrationStatements(sql)) await DB.prepare(statement).run();
  }
  const env = { DB, NAKWOL_GUILD_ID: guild, NAKWOL_MEMBER_ROLE_ID: season,
    DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret', AUTH_ORIGIN: 'https://auth.test' };
  await DB.prepare("INSERT INTO users VALUES ('u','Tester',NULL,'active',0,0)").run();
  await DB.prepare("INSERT INTO auth_identities VALUES ('i','u','discord','1493410906456064113',0,0)").run();
  await DB.prepare("INSERT INTO applications VALUES ('site','Site','[\"https://site.test/\"]','active',0,0)").run();
  await DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('site','member',0,0)").run();
  await DB.prepare("INSERT INTO membership_qualifications VALUES ('q1','First',?,'active',0,0),('q2','Second',?,'active',0,0)").bind(first, second).run();
  await DB.prepare("INSERT INTO access_tokens VALUES (?, 'u','site',?,NULL,0)").bind(await sha256Base64Url('token'), Date.now() + 60000).run();
  const select = async (mode = 'any', ids = ['q1', 'q2']) => {
    await DB.prepare("INSERT OR REPLACE INTO application_qualification_requirements VALUES ('site',?,?,0)").bind(mode, JSON.stringify(ids)).run();
  };
  const refresh = (roles: string[] = [first]) => upsertMembership(env, 'u', true, roles.includes(season) ? 'member' : 'user', roles);
  const access = () => diagnoseApplicationAccess(env, 'u', 'site');
  const me = () => app.request('https://auth.test/me?client_id=site', { headers: { Authorization: 'Bearer token', 'X-Nakwol-Require-Member': 'true' } }, env);
  await refresh();
  await t.test('legacy site still requires season3', async () => {
    assert.equal((await access()).reason, 'SEASON_ROLE_MISSING');
  });
  await t.test('ANY grants old Connect member gate without changing global membership', async () => {
    await select();
    const response = await me();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.membership.is_member, true);
    assert.equal(body.data.membership.global_is_member, false);
    assert.equal(body.data.membership.scope, 'application');
    assert.equal(body.data.membership.role, 'user');
    assert.equal((await DB.prepare("SELECT role FROM memberships WHERE user_id='u'").first())?.role, 'user');
  });
  await t.test('ALL requires every selected role', async () => {
    await select('all');
    assert.equal((await access()).reason, 'QUALIFICATION_MISSING');
    await refresh([first, second]);
    assert.equal((await access()).allowed, true);
    await refresh();
  });
  await t.test('disabled and unknown selected qualifications fail closed even if ANY has another match', async () => {
    await select();
    await DB.prepare("UPDATE membership_qualifications SET status='disabled' WHERE id='q2'").run();
    assert.equal((await access()).reason, 'QUALIFICATION_CONFIGURATION_INVALID');
    await DB.prepare("UPDATE membership_qualifications SET status='active' WHERE id='q2'").run();
    await select('any', ['q1', 'unknown']);
    assert.equal((await access()).reason, 'QUALIFICATION_CONFIGURATION_INVALID');
    await select('any', []);
    assert.equal((await access()).reason, 'QUALIFICATION_CONFIGURATION_INVALID');
    await select();
  });
  await t.test('custom policy replaces legacy extra roles and season configuration', async () => {
    await DB.prepare("INSERT INTO application_role_requirements VALUES ('site',?,0)").bind(JSON.stringify([season])).run();
    assert.equal((await diagnoseApplicationAccess({ ...env, NAKWOL_MEMBER_ROLE_ID: '' }, 'u', 'site')).allowed, true);
    await DB.prepare("DELETE FROM application_role_requirements").run();
  });
  await t.test('membership freshness and guild remain required despite legacy Season3 inactive status', async () => {
    await DB.prepare("UPDATE memberships SET checked_at=?").bind(Date.now() - MEMBERSHIP_MAX_AGE_MS).run();
    assert.equal((await access()).reason, 'MEMBERSHIP_REFRESH_REQUIRED');
    await refresh();
    await DB.prepare("UPDATE memberships SET is_guild_member=0").run();
    assert.equal((await access()).reason, 'MEMBERSHIP_INACTIVE');
    await refresh();
    await DB.prepare("UPDATE memberships SET status='inactive'").run();
    assert.equal((await access()).allowed, true);
    await refresh();
  });
  await t.test('manual grants survive custom rules but cannot bypass reauthentication or disabled users/apps', async () => {
    await refresh([]);
    await DB.prepare("INSERT INTO application_access_grants VALUES ('site','1493410906456064113','active','test','u',0)").run();
    assert.equal((await access()).reason, 'MANUAL_GRANT');
    await DB.prepare("INSERT INTO user_reauthentication VALUES ('u',?,'u','test')").bind(Date.now() + 1000).run();
    assert.equal((await access()).reason, 'REAUTHENTICATION_REQUIRED');
    await DB.prepare("DELETE FROM user_reauthentication").run();
    await DB.prepare("UPDATE users SET status='disabled'").run();
    assert.equal((await access()).reason, 'USER_DISABLED');
    await DB.prepare("UPDATE users SET status='active'").run();
    await DB.prepare("UPDATE applications SET status='disabled'").run();
    assert.equal((await access()).reason, 'APP_DISABLED');
    await DB.prepare("UPDATE applications SET status='active'").run();
    await DB.prepare("DELETE FROM application_access_grants").run();
    await refresh();
  });
  await t.test('custom membership does not grant AUTH operator privileges', async () => {
    await assert.rejects(DB.prepare("UPDATE application_settings SET access_policy='admin'").run(), /CUSTOM_QUALIFICATIONS_ACTIVE/);
    await DB.prepare("DELETE FROM application_qualification_requirements").run();
    await DB.prepare("UPDATE application_settings SET access_policy='admin'").run();
    assert.equal((await access()).reason, 'AUTH_OPERATOR_REQUIRED');
    await DB.prepare("UPDATE application_settings SET access_policy='member'").run();
    await select();
  });
  await t.test('removing custom policy restores legacy behavior', async () => {
    await DB.prepare("DELETE FROM application_qualification_requirements").run();
    assert.equal((await access()).reason, 'SEASON_ROLE_MISSING');
  });
});
