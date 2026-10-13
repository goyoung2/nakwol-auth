import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicationAccessPolicy, isApplicationAccessAllowed } from '../../src/policy';
import { createAuthFixture } from './auth-fixture';

test('policy defaults and authorization stay fail-closed with real database rows', async t => {
  const {env,DB,dispose}=await createAuthFixture();t.after(dispose);
  const policy=async(value:string)=>DB.prepare("INSERT OR REPLACE INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site',?,0,0)").bind(value).run();
  await t.test('missing and malformed settings require member',async()=>{
    assert.equal(await getApplicationAccessPolicy(env,'site'),'member');
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
    await DB.prepare('PRAGMA ignore_check_constraints=ON').run();
    for(const value of ['unexpected','']) {
      await policy(value);
      assert.equal(await getApplicationAccessPolicy(env,'site'),'member');
      assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
    }
  });
  await t.test('guest and public alias require an active existing user and application',async()=>{
    for(const value of ['guest','public']) {
      await policy(value);
      assert.equal(await getApplicationAccessPolicy(env,'site'),'guest');
      assert.equal(await isApplicationAccessAllowed(env,'user','site'),true);
      assert.equal(await isApplicationAccessAllowed(env,'missing','site'),false);
      assert.equal(await isApplicationAccessAllowed(env,'user','missing'),false);
      await DB.prepare("UPDATE users SET status='disabled' WHERE id='user'").run();
      assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
      await DB.prepare("UPDATE users SET status='active' WHERE id='user'").run();
    }
  });
  await t.test('stale membership cannot authorize member access',async()=>{
    await policy('member');
    await DB.prepare("INSERT INTO memberships(user_id,guild_id,is_guild_member,role,status,checked_at,role_ids) VALUES('user',?,1,'member','active',0,?)")
      .bind(env.NAKWOL_GUILD_ID,JSON.stringify([env.NAKWOL_MEMBER_ROLE_ID])).run();
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
    await DB.prepare("UPDATE memberships SET checked_at=? WHERE user_id='user'").bind(Date.now()).run();
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),true);
  });
  await t.test('admin requires AUTH operator; lab developer does not grant admin',async()=>{
    await policy('admin');
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
    await DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES('user','developer','active',0,0)").run();
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),false);
    await policy('lab');
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),true);
    await policy('admin');
    await DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES('user',0)").run();
    assert.equal(await isApplicationAccessAllowed(env,'user','site'),true);
  });
});
