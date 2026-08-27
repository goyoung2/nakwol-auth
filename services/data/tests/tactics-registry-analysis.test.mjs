import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

function isOwnableCandidate(tactic) {
  const m = tactic.m ?? {};
  return tactic.on === true && m.class === 5 && m.learn === 1 && m.get === 3 && (m.copy ?? 0) === 0;
}

test('authoritative Registry exposes a conservative ownable tactic candidate set', async () => {
  const seed = await readRegistrySeed();
  const uniqueIds = new Set(seed.generals.map((g) => g.ut).filter(Boolean));
  const candidates = seed.tactics.filter(isOwnableCandidate);
  const uniqueInside = candidates.filter((t) => uniqueIds.has(t.id));
  const byCategory = Object.fromEntries([...new Set(candidates.map((t) => t.cat))].sort().map((cat) => [cat, candidates.filter((t) => t.cat === cat).length]));
  const byRarity = Object.fromEntries([...new Set(candidates.map((t) => String(t.rar)))].sort().map((rar) => [rar, candidates.filter((t) => String(t.rar) === rar).length]));
  const duplicateNames = [...new Set(candidates.map((t) => t.name))]
    .map((name) => ({ name, ids: candidates.filter((t) => t.name === name).map((t) => t.id) }))
    .filter((x) => x.ids.length > 1)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  console.log('OWNABLE_TACTIC_CANDIDATES_BEGIN');
  console.log(JSON.stringify({
    count: candidates.length,
    uniqueReferencedCount: uniqueInside.length,
    byCategory,
    byRarity,
    duplicateNames,
    first: candidates.slice(0, 25).map((t) => `${t.id}:${t.name}`),
    last: candidates.slice(-25).map((t) => `${t.id}:${t.name}`),
  }, null, 2));
  console.log('OWNABLE_TACTIC_CANDIDATES_END');
  assert.equal(uniqueInside.length, 1);
});
