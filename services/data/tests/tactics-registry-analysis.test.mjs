import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

function key(row) {
  const m = row.m ?? {};
  return JSON.stringify({ cat: row.cat ?? null, rar: row.rar ?? null, class: m.class ?? null, type: m.type ?? null, learn: m.learn ?? null, get: m.get ?? null, copy: m.copy ?? null });
}

test('inspect tactic ownership evidence in authoritative Registry seed', async () => {
  const seed = await readRegistrySeed();
  const uniqueIds = new Set(seed.generals.map((g) => g.ut).filter(Boolean));
  const grouped = new Map();
  for (const tactic of seed.tactics) {
    const k = key(tactic);
    const entry = grouped.get(k) ?? { n: 0, unique: 0, samples: [] };
    entry.n += 1;
    if (uniqueIds.has(tactic.id)) entry.unique += 1;
    if (entry.samples.length < 6) entry.samples.push(`${tactic.id}:${tactic.name}`);
    grouped.set(k, entry);
  }
  const rows = [...grouped.entries()].map(([k, v]) => ({ ...JSON.parse(k), ...v })).sort((a, b) => b.n - a.n);
  console.log('TACTIC_CLASSIFICATION_EVIDENCE_BEGIN');
  console.log(JSON.stringify({ total: seed.tactics.length, uniqueReferenced: uniqueIds.size, groups: rows }, null, 2));
  console.log('TACTIC_CLASSIFICATION_EVIDENCE_END');
  assert.equal(seed.tactics.length, 1077);
});
