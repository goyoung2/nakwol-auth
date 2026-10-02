import test from 'node:test';
import assert from 'node:assert/strict';
import { authFixture } from '../helpers/auth-d1';
import { resolveAuthPolicy, saveAuthPolicy } from '../../src/auth-policy-settings';

async function fixture() {
  const f = await authFixture();
  await f.env.DB.prepare("INSERT INTO auth_operators VALUES ('member','operator',0,NULL)").run();
  await f.env.DB.prepare("INSERT INTO application_settings VALUES ('a',NULL,'html','member',NULL,0,0)").run();
  return f;
}
test('policy bounds and current operator authority are enforced', async () => {
  const f = await fixture();
  try {
    const input = {actor:'member',clientId:'a',expectedVersion:0,reason:'test'};
    for (const patch of [{leaseSeconds:0},{leaseSeconds:301},{sessionIdleSeconds:7200,sessionAbsoluteSeconds:3600}]) {
      await assert.rejects(saveAuthPolicy(f.env,{...input,patch}));
    }
    const saved = await saveAuthPolicy(f.env,{...input,patch:{sessionIdleSeconds:7200,sessionAbsoluteSeconds:7200}});
    assert.equal(saved.effective.sessionAbsoluteSeconds,7200);
    assert.equal(saved.policyVersion,1);
    await assert.rejects(saveAuthPolicy(f.env,{...input,patch:{leaseSeconds:60}}),/VERSION_CONFLICT/);
    await f.env.DB.prepare("DELETE FROM auth_operators").run();
    await assert.rejects(saveAuthPolicy(f.env,{...input,expectedVersion:1,patch:{leaseSeconds:60}}),/FORBIDDEN/);
  } finally { await f.dispose(); }
});
test('security change requires actor and payload bound preview; CAS writes one audit', async () => {
  const f = await fixture();
  try {
    const input = {actor:'member',clientId:'a',expectedVersion:0,reason:'review',patch:{accessPolicy:'guest'}};
    await assert.rejects(saveAuthPolicy(f.env,input),/PREVIEW_REQUIRED/);
    const preview = await saveAuthPolicy(f.env,{...input,preview:true});
    await assert.rejects(saveAuthPolicy(f.env,{...input,patch:{accessPolicy:'admin'},previewToken:preview.previewToken}),/PREVIEW_REQUIRED/);
    const results=await Promise.allSettled(Array.from({length:8},()=>saveAuthPolicy(f.env,{...input,previewToken:preview.previewToken})));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await resolveAuthPolicy(f.env,'a')).accessPolicy,'guest');
    assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM auth_policy_operations').first<{n:number}>())?.n,1);
  } finally { await f.dispose(); }
});
test('owner is limited to its current app and delegated times; global cap clamps override', async () => {
  const f=await fixture();
  try {
    await f.env.DB.prepare("INSERT INTO users VALUES ('owner','Owner',NULL,'active',0,0)").run();
    await f.env.DB.prepare("INSERT INTO connect_developers VALUES ('owner','developer','active',0,0,NULL)").run();
    await f.env.DB.prepare("INSERT INTO application_owners VALUES ('a','owner','owner',0)").run();
    const input={actor:'owner',clientId:'a',expectedVersion:0,reason:'service hours'};
    await assert.rejects(saveAuthPolicy(f.env,{...input,clientId:'b',patch:{leaseSeconds:60}}),/FORBIDDEN/);
    await assert.rejects(saveAuthPolicy(f.env,{...input,patch:{accessPolicy:'guest'}}),/FORBIDDEN/);
    await assert.rejects(saveAuthPolicy(f.env,{...input,patch:{accessTokenSeconds:600}}),/FORBIDDEN/);
    await saveAuthPolicy(f.env,{...input,patch:{leaseSeconds:240}});
    const globalInput={actor:'member',clientId:null,expectedVersion:0,reason:'global cap',patch:{leaseSeconds:120}};
    const preview=await saveAuthPolicy(f.env,{...globalInput,preview:true});
    const global=await saveAuthPolicy(f.env,{...globalInput,previewToken:preview.previewToken});
    assert.equal(global.policyVersion,2);
    assert.equal((await resolveAuthPolicy(f.env,'a')).effective.leaseSeconds,120);
    const savedAfterClamp = await saveAuthPolicy(f.env,{...input,expectedVersion:2,patch:{sessionIdleSeconds:7200}});
    assert.equal(savedAfterClamp.effective.leaseSeconds,120);
    assert.equal(savedAfterClamp.stored.leaseSeconds,240);
    await assert.rejects(saveAuthPolicy(f.env,{...input,expectedVersion:3,patch:{leaseSeconds:240}}),/GLOBAL_POLICY_CAP_EXCEEDED/);
    await f.env.DB.prepare("UPDATE connect_developers SET status='disabled' WHERE user_id='owner'").run();
    await assert.rejects(saveAuthPolicy(f.env,{...input,expectedVersion:2,patch:{leaseSeconds:60}}),/FORBIDDEN/);
  } finally {await f.dispose();}
});
test('TTL reduction persists for unseen tokens after later policy expansion', async () => {
  const f=await fixture();
  try {
    await f.env.DB.prepare("INSERT INTO access_tokens VALUES ('unseen','member','a',3600000,NULL,0)").run();
    for (const [expectedVersion,accessTokenSeconds] of [[0,600],[1,3600]]) {
      const input={actor:'member',clientId:null,expectedVersion,reason:'TTL change',patch:{accessTokenSeconds}};
      const preview=await saveAuthPolicy(f.env,{...input,preview:true});
      await saveAuthPolicy(f.env,{...input,previewToken:preview.previewToken});
    }
    assert.equal((await f.env.DB.prepare("SELECT expires_at FROM access_tokens WHERE token_hash='unseen'").first<{expires_at:number}>())?.expires_at,600000);
  } finally {await f.dispose();}
});
test('failed audit insertion rolls policy and token updates back atomically', async () => {
  const f=await fixture();
  try {
    await f.env.DB.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON auth_policy_operations BEGIN SELECT RAISE(ABORT, 'audit failure'); END").run();
    await assert.rejects(saveAuthPolicy(f.env,{actor:'member',clientId:'a',expectedVersion:0,reason:'test',patch:{leaseSeconds:60}}),/audit failure/);
    assert.equal((await resolveAuthPolicy(f.env,'a')).policyVersion,0);
    assert.equal((await f.env.DB.prepare('SELECT version FROM auth_policy_revision').first<{version:number}>())?.version,0);
  } finally {await f.dispose();}
});
test('preview invalidated between validation and transaction cannot authorize mutation', async () => {
  const f=await fixture();
  try {
    const input={actor:'member',clientId:'a',expectedVersion:0,reason:'review',patch:{accessPolicy:'guest'}};
    const preview=await saveAuthPolicy(f.env,{...input,preview:true});
    const DB = new Proxy(f.env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: Parameters<typeof target.batch>[0]) => {
          await target.prepare('DELETE FROM auth_policy_previews WHERE token=?').bind(preview.previewToken).run();
          return target.batch(statements);
        };
        const value=Reflect.get(target,property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(saveAuthPolicy({...f.env,DB},{...input,previewToken:preview.previewToken}),/VERSION_CONFLICT/);
    assert.equal((await resolveAuthPolicy(f.env,'a')).accessPolicy,'member');
    assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM auth_policy_operations').first<{n:number}>())?.n,0);
  } finally {await f.dispose();}
});
