import test from 'node:test';
import assert from 'node:assert/strict';
import { runFaultChecks } from '../../../tests/fixtures/gate-benchmark/faults.mjs';
import { createGate } from '../src/server/gate.mjs';

test('T11 public gate fault, observation and presentation benchmark contracts', { timeout: 30000 }, async () => {
  const result = await runFaultChecks();
  assert.equal(result.passed, true);
  assert.ok(result.checks.every(check => check.passed));
  assert.equal(result.faults.length, 6);
  assert.ok(result.faults.every(fault => fault.failure.protectedHandlerCalls === 0 && fault.recovery.protectedHandlerCalls === 1));
});

test('legacy public gate removes vendor shared cache headers after authentication', async () => {
  const original = globalThis.fetch;
  const gate = createGate({ clientId: 'cache-legacy', siteUrl: 'https://site.test/', authOrigin: 'https://auth.test', accessPolicy: 'member' });
  let assets = 0;
  const host = { sessionSecret: 'synthetic-legacy-key-01234567890123456789', serveAsset: async request => {
    assets++;
    const status = request.headers.has('If-None-Match') ? 304 : request.headers.has('Range') ? 206 : 200;
    return new Response(status === 304 || request.method === 'HEAD' ? null : 'synthetic', { status, headers: { ETag: '"synthetic"', 'Cache-Control': 'public,max-age=31536000,immutable', 'CDN-Cache-Control': 'public,max-age=31536000', 'Cloudflare-CDN-Cache-Control': 'public,max-age=31536000', 'Surrogate-Control': 'max-age=31536000' } });
  } };
  try {
    globalThis.fetch = async () => Response.json({ ok: true, data: { id: 'synthetic', status: 'active', membership: { is_member: true } }, application_access: { client_id: 'cache-legacy', allowed: true, source: 'policy' }, expires_at: Date.now() + 3600000 });
    const session = await gate(new Request('https://site.test/__nakwol/session', { method: 'POST', headers: { Origin: 'https://site.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: 'synthetic' }) }), host);
    assert.equal(session.status, 204);
    const cookie = session.headers.get('Set-Cookie').split(';')[0];
    for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-3' } }, { headers: { 'If-None-Match': '"synthetic"' } }]) {
      const response = await gate(new Request('https://site.test/fixture', { ...options, headers: { ...options.headers, Cookie: cookie } }), host);
      assert.match(response.headers.get('Cache-Control'), /^private, no-(?:cache|store)/);
      for (const header of ['CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control', 'Surrogate-Control']) assert.equal(response.headers.get(header), null, header);
      const before = assets;
      assert.equal((await gate(new Request('https://site.test/fixture', options), host)).status, 401);
      assert.equal(assets, before);
    }
  } finally { globalThis.fetch = original; }
});
