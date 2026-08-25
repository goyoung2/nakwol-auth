import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Worker distribution exposes CLI package, manifest, and llms discovery', async () => {
  const routes = await readFile(new URL('../../src/connect-cli-distribution.ts', import.meta.url), 'utf8');
  assert.match(routes, /\/connect\/cli\/package\.tgz/);
  assert.match(routes, /\/connect\/cli\/manifest\.json/);
  assert.match(routes, /\/llms\.txt/);
  assert.match(routes, /@nakwol\/connect/);
});

test('generated CLI package asset exists and is non-empty base64', async () => {
  const encoded = (await readFile(new URL('../../src/assets/nakwol-connect-cli.tgz.b64.js.txt', import.meta.url), 'utf8')).trim();
  assert.ok(encoded.length > 100);
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
});
