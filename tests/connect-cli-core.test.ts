import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseAvailableClientId,
  normalizeClientId,
  validateRedirectUris,
} from '../src/connect-cli-core';

test('client id normalizes project names to lowercase hyphen form', () => {
  assert.equal(normalizeClientId('  My Battle_Map!!  '), 'my-battle-map');
  assert.equal(normalizeClientId('---NAKWOL---MAP---'), 'nakwol-map');
});

test('client id is capped at 63 characters and never ends with a hyphen', () => {
  const id = normalizeClientId('A'.repeat(80) + '---');
  assert.equal(id.length, 63);
  assert.match(id, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
});

test('available client id keeps requested normalized id', async () => {
  const id = await chooseAvailableClientId('Battle Map', async () => false, () => 'zz99');
  assert.equal(id, 'battle-map');
});

test('collision adds deterministic short suffix', async () => {
  const used = new Set(['battle-map']);
  const id = await chooseAvailableClientId('Battle Map', async (candidate) => used.has(candidate), () => '7h4k');
  assert.equal(id, 'battle-map-7h4k');
});

test('redirect URI validation accepts exact http/https URLs and deduplicates', () => {
  const result = validateRedirectUris([
    'http://localhost:5173/',
    'https://example.pages.dev/',
    'https://example.pages.dev/',
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: ['http://localhost:5173/', 'https://example.pages.dev/'],
  });
});

test('redirect URI validation rejects unsupported schemes and fragments', () => {
  assert.equal(validateRedirectUris(['ftp://example.com/']).ok, false);
  assert.equal(validateRedirectUris(['https://example.com/#token']).ok, false);
});
