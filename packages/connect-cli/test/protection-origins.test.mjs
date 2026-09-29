import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverProtectionOrigins } from '../src/protection-origins.mjs';

const config = { protection: { provider: 'cloudflare-pages', rollback: { provider: 'cloudflare-pages', accountId: 'registered-account', projectName: 'registered-site' } } };
const json = result => Response.json({ success: true, result });

test('origin discovery requires explicit opt-in and registered project scope', async () => {
  const fetchImpl = async () => { throw new Error('must not fetch'); };
  assert.equal((await discoverProtectionOrigins(config, { fetchImpl })).discoveryEvidence.status, 'disabled');
  await assert.rejects(discoverProtectionOrigins({ protection: { provider: 'cloudflare-pages' } }, { discoverOrigins: true, fetchImpl }), /registered/);
  const other = await discoverProtectionOrigins({ protection: { provider: 'vercel' } }, { discoverOrigins: true, fetchImpl });
  assert.equal(other.discoveryEvidence.status, 'unsupported');
});

test('Pages discovery reads only scoped project and paginated deployments without leaking credentials', async () => {
  const calls = [];
  const result = await discoverProtectionOrigins(config, { discoverOrigins: true, apiToken: 'test-secret', fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    assert.match(url, /^https:\/\/api.cloudflare.com\/client\/v4\/accounts\/registered-account\/pages\/projects\/registered-site(?:\?|\/|$)/);
    if (!url.includes('/deployments')) return json({ name: 'registered-site', subdomain: 'registered-site.pages.dev', domains: ['custom.example'] });
    if (url.includes('page=1&')) return json(Array.from({ length: 10 }, (_, n) => ({ url: `https://deployment${n}.registered-site.pages.dev`, aliases: ['branch.registered-site.pages.dev'] })));
    return json([]);
  } });
  assert.equal(calls.length, 3);
  assert.equal(result.discoveryEvidence.status, 'complete');
  assert.equal(result.origins.length, 13);
  assert.ok(result.discoveryEvidence.origins.every(item => item.status === 'unknown'));
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('100 deployment bound is partial, and provider failure never means closed', async () => {
  let calls = 0;
  const result = await discoverProtectionOrigins(config, { discoverOrigins: true, apiToken: 'token', fetchImpl: async url => {
    calls++;
    return json(url.includes('/deployments') ? Array.from({ length: 10 }, () => ({ url: 'https://old.registered-site.pages.dev' })) : { name: 'registered-site' });
  } });
  assert.equal(calls, 11);
  assert.equal(result.discoveryEvidence.deploymentCount, 100);
  assert.equal(result.discoveryEvidence.status, 'partial');
  const failed = await discoverProtectionOrigins(config, { discoverOrigins: true, apiToken: 'token', fetchImpl: async () => new Response('token', { status: 404 }) });
  assert.equal(failed.discoveryEvidence.status, 'unreachable');
  assert.deepEqual(failed.origins, []);
  assert.ok(!JSON.stringify(failed).includes('token'));
});

test('invalid provider origins and project mismatches are not accepted silently', async () => {
  const result = await discoverProtectionOrigins(config, { discoverOrigins: true, apiToken: 'token', fetchImpl: async url => json(url.includes('/deployments') ? [] : { name: 'registered-site', domains: ['https://user:password@example.com/', 'https://example.com/path'] }) });
  assert.equal(result.discoveryEvidence.status, 'partial');
  assert.deepEqual(result.origins, []);
  const mismatch = await discoverProtectionOrigins(config, { discoverOrigins: true, apiToken: 'token', fetchImpl: async () => json({ name: 'another-site', subdomain: 'another.pages.dev' }) });
  assert.equal(mismatch.discoveryEvidence.status, 'unreachable');
  assert.deepEqual(mismatch.origins, []);
});
