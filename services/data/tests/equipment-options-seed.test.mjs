import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const seedPath = fileURLToPath(new URL('../seeds/equipment-options-v0.8.json', import.meta.url));

test('v0.8 equipment option supplement freezes 106 skills and 74 effects from Korean client evidence', () => {
  assert.equal(existsSync(seedPath), true, 'missing equipment-options-v0.8.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));

  assert.equal(seed.version, '0.8.0');
  assert.equal(seed.schema, 3);
  assert.equal(seed.source.repository, 'goyoung2/nslg-warroom');
  assert.equal(seed.source.path, 'viewer/enemy-decks/gear-catalog.json');
  assert.equal(seed.source.blob_sha, 'c1f94bc603be73c7498aa7258ba5b68cb8c32536');
  assert.deepEqual(seed.counts, {
    skills: 106,
    effects: 74,
    identities: 180,
    unresolved: 0,
    canonical_applicability: 0,
  });

  assert.equal(seed.identities.length, 180);
  assert.equal(seed.identities.filter((row) => row.kind === 'skill').length, 106);
  assert.equal(seed.identities.filter((row) => row.kind === 'effect').length, 74);
  assert.equal(new Set(seed.identities.map((row) => row.id)).size, 180);

  const guju = seed.identities.find((row) => row.id === 'ets:56');
  assert.equal(guju?.native_id, 56);
  assert.equal(guju?.kind, 'skill');
  assert.equal(guju?.name, '구주');
  assert.match(guju?.description ?? '', /통솔/);
  assert.equal(guju?.evidence_state, 'canonical');

  const projection = seed.identities.find((row) => row.id === 'ete:54');
  assert.equal(projection?.native_id, 54);
  assert.equal(projection?.kind, 'effect');
  assert.equal(projection?.name, '투영');
  assert.match(projection?.description ?? '', /주는 피해가 2% 증가/);
  assert.equal(projection?.evidence_state, 'canonical');

  assert.deepEqual(seed.applicability, [], 'initial seed must not invent weapon/mount applicability');
});
