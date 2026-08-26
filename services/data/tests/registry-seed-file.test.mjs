import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

test('registry seed loader reconstructs the compressed committed seed parts', async () => {
  const seed = await readRegistrySeed();
  assert.equal(seed.v, '0.2.0');
  assert.equal(seed.counts.generals, 209);
  assert.equal(seed.counts.tactics, 1077);
});
