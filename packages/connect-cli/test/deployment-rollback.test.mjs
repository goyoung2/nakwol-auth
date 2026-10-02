import test, {after} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256,protectionBuildHash} from '../src/protection-inventory.mjs';
const temporary=mkdtempSync(join(tmpdir(),'rollback-proof-'));
after(()=>{rmSync(temporary,{recursive:true,force:true});delete process.env.ROLLBACK_TEST_COOKIE;});
process.env.ROLLBACK_TEST_COOKIE='fixture-only';
import assert from 'node:assert/strict';
import { rollbackProtection, validateRollbackConfig, readCurrentDeployment } from '../src/deployment-rollback.mjs';
const site = 'https://example.test/';
function fixture(provider = 'cloudflare-workers', newer = false) {
  const report = { ok: true, deploymentId: 'old', protectionStatus: 'anonymous-blocking-verified', origins: [site], expectedRuntime: '0.7.1', observedRuntimeVersions: ['0.7.1'], inspectionScope: 'installed-assets', checkedAt: '2026-09-28T00:00:00Z', requestCount: 4, checks: Array.from({ length: 4 }, () => ({ ok: true })) };
  const files=[{path:'/index.html',size:7,sha256:sha256('private')}];
  const manifest={schemaVersion:1,deploymentId:'old',buildHash:protectionBuildHash(files),runtimeVersion:'0.7.1',capabilities:['all-paths'],files};
  const raw=JSON.stringify(manifest),manifestFile=join(temporary,'manifest.json');writeFileSync(manifestFile,raw);
  Object.assign(report,{releaseAccepted:true,manifestUnchanged:true,evidenceBinding:{...manifest,manifestHash:sha256(raw)},authenticatedChecks:[{ok:true}],requestCount:5});
  const config = { protection: { provider, siteUrl: site, rollback: { enabled: true, provider, accountId: 'account', scriptName: 'worker', projectName: 'pages', serializedDeployments: true, previousVerified: { deploymentId: 'old', runtimeVersion: '0.7.1', manifestFile, report } } } };
  const calls = [];
  const active = { id: newer ? 'newer' : 'failed', created_on: '2026-09-29T00:00:00Z' };
  const old = { id: 'old', created_on: '2026-09-28T00:00:00Z', versions: [{ version_id: 'version-old', percentage: 100 }], environment: 'production', latest_stage: { status: 'success' } };
  const options = { config,sessionCookieEnv:'ROLLBACK_TEST_COOKIE', failedDeploymentId: 'failed', apiToken: 'fixture-only', failureReport: { ok: false, deploymentId: 'failed', origins: [site], checks: [{ ok: false, detail: 'HTTP 200; gate=missing' }] }, verifyImpl: async ({ expectRuntime,manifest:passedManifest,sessionCookieEnv }) => {assert.equal(passedManifest,manifestFile);assert.equal(sessionCookieEnv,'ROLLBACK_TEST_COOKIE');return {...report,ok:expectRuntime==='0.7.1'};}, fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if(init.method==='POST')active.id='recovery';
    const result = init.method === 'POST' ? { id: 'recovery' } : url.endsWith('/old') ? old : provider === 'cloudflare-workers' ? { deployments: [active] } : { canonical_deployment: active };
    return Response.json({ success: true, result });
  } };
  return { options, calls, old };
}
for (const provider of ['cloudflare-workers', 'cloudflare-pages']) {
  test(`${provider}: rolls back only explicit verified target and verifies recovery`, async () => {
    const { options, calls } = fixture(provider);
    const result = await rollbackProtection(options);
    assert.equal(result.status, 'recovery-verified');
    const writes = calls.filter(c => c.method === 'POST');
    assert.equal(writes.length, 1);
    if (provider === 'cloudflare-workers') assert.deepEqual(JSON.parse(writes[0].body), { strategy: 'percentage', versions: [{ version_id: 'version-old', percentage: 100 }] });
    else assert.ok(writes[0].url.endsWith('/deployments/old/rollback'));
  });
  test(`${provider}: newer current deployment refuses all writes`, async () => {
    const { options, calls } = fixture(provider, true);
    await assert.rejects(rollbackProtection(options), /differs/);
    assert.equal(calls.some(c => c.method === 'POST'), false);
  });
}
test('network outages and HTTP 503 do not trigger rollback', async () => {
  for (const detail of ['fetch failed', 'HTTP 503; gate=missing']) {
    const { options, calls } = fixture();
    options.failureReport.checks[0].detail = detail;
    assert.equal((await rollbackProtection(options)).status, 'not-eligible');
    assert.equal(calls.length, 0);
  }
});
test('invalid baseline, disabled policy and missing serialization rejected', () => {
  for (const mutate of [p => p.enabled = false, p => p.serializedDeployments = false, p => p.previousVerified.report.checks = [], p => p.previousVerified.report.observedRuntimeVersions = ['unknown']]) {
    const { options } = fixture(); mutate(options.config.protection.rollback);
    assert.throws(() => validateRollbackConfig(options.config));
  }
});
test('failed recovery remains distinct from accepted rollback', async () => {
  const { options } = fixture(); options.verifyImpl = async () => ({ ok: false });
  const result = await rollbackProtection(options);
  assert.equal(result.rollbackAccepted, true); assert.equal(result.ok, false); assert.equal(result.status, 'recovery-failed');
});
test('deployment change during preflight prevents write', async () => {
  const { options, calls } = fixture(); const fetch = options.fetchImpl; let reads = 0;
  options.fetchImpl = async (url, init) => {
    if (url.endsWith('/deployments') && ++reads === 2) return Response.json({ success: true, result: { deployments: [{ id: 'newer', created_on: '2026-09-30T00:00:00Z' }] } });
    return fetch(url, init);
  };
  await assert.rejects(rollbackProtection(options), /changed/);
  assert.equal(calls.some(c => c.method === 'POST'), false);
});

test('current deployment reader supports initial baseline capture without baseline', async () => {
  for (const provider of ['cloudflare-workers', 'cloudflare-pages']) {
    const { options, calls } = fixture(provider);
    delete options.config.protection.rollback.previousVerified;
    assert.equal((await readCurrentDeployment(options.config, options)).id, 'failed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  }
});
test('provider mismatch is refused before API access', async () => {
  const { options, calls } = fixture();
  options.config.protection.provider = 'cloudflare-pages';
  await assert.rejects(readCurrentDeployment(options.config, options), /differs/);
  await assert.rejects(rollbackProtection(options), /differs/);
  assert.equal(calls.length, 0);
});
test('private canary in a denied response triggers rollback; explicit indeterminate never does',async()=>{
 const exposed=fixture();exposed.options.failureReport.checks=[{ok:false,classification:'exposed',detail:'HTTP 401; private canary'}];
 assert.equal((await rollbackProtection(exposed.options)).rollbackAccepted,true);
 for(const status of [200,404,503]) {const f=fixture();f.options.failureReport.checks=[{ok:false,classification:'indeterminate',detail:`HTTP ${status}; incomplete`}];assert.equal((await rollbackProtection(f.options)).rollbackAccepted,false);assert.equal(f.calls.length,0);}
});
test('strong rollback baselines reject mismatched or incomplete release evidence',()=>{
 for(const mutation of [r=>r.evidenceBinding.deploymentId='other',r=>r.releaseAccepted=false,r=>r.authenticatedChecks[0].ok=false]) {
  const f=fixture();const report=f.options.config.protection.rollback.previousVerified.report;

  assert.doesNotThrow(()=>validateRollbackConfig(f.options.config));mutation(report);assert.throws(()=>validateRollbackConfig(f.options.config),/evidence binding/);
 }
});
test('legacy anonymous baseline cannot authorize automatic rollback',()=>{
 const f=fixture();const report=f.options.config.protection.rollback.previousVerified.report;
 delete report.evidenceBinding;delete report.releaseAccepted;
 assert.throws(()=>validateRollbackConfig(f.options.config),/re-verification/);
});

test('rollback without a recovery session never claims verified recovery',async()=>{
 const f=fixture();delete f.options.sessionCookieEnv;const result=await rollbackProtection(f.options);assert.equal(result.rollbackAccepted,true);assert.equal(result.ok,false);assert.equal(result.status,'recovery-unverified');
});
test('anonymous-only recovery result cannot claim verified recovery',async()=>{
 const f=fixture();f.options.verifyImpl=async()=>({ok:true});const result=await rollbackProtection(f.options);assert.equal(result.rollbackAccepted,true);assert.equal(result.ok,false);assert.equal(result.status,'recovery-failed');
});
