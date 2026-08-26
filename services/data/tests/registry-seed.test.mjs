import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

test('committed registry seed contains confirmed source counts and known joins', async () => {
  const seed = await readRegistrySeed();
  assert.equal(seed.v, '0.2.0');
  assert.equal(seed.schema, 2);
  assert.deepEqual(seed.counts, {
    generals: 209,
    generals_enabled: 140,
    tactics: 1077,
    equipment: 134,
    weapons: 97,
    mounts: 37,
    stat_types: 281,
    formations: 8,
    warbooks: 442,
  });
  const cao = seed.generals.find((row) => row.n === 1000);
  assert.equal(cao.name, '조조');
  assert.equal(cao.ut, 't:100001');
  assert.equal(cao.on, true);
  const hiddenMissing = seed.generals.filter((row) => !row.on && row.ut == null && row.m.utn != null);
  assert.equal(hiddenMissing.length, 46);
  assert.equal(seed.tactics.find((row) => row.n === 100001).name, '난세의 간웅');
  assert.equal(seed.equipment.filter((row) => row.type === 'weapon').length, 97);
  assert.equal(seed.equipment.filter((row) => row.type === 'mount').length, 37);
  assert.equal(seed.formations.find((row) => row.n === 101).name, '일자진');
  assert.equal(seed.warbooks.find((row) => row.n === 10001).name, '<맹덕신서> 상권');
});

test('registry seed records provenance without inventing unresolved domains', async () => {
  const seed = await readRegistrySeed();
  assert.equal(seed.source.lifecycle, 'AUTHORITATIVE');
  for (const domain of ['heroes','skills','equipment','horses','attributes','formations','warbooks']) {
    assert.ok(seed.source.sources[domain]);
    assert.ok(seed.source.sources[domain].source_hashes.length >= 1);
  }
  assert.equal('promotion_items' in seed, false);
  assert.equal('equipment_traits' in seed, false);
});
