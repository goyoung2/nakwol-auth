import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

function isBroadCandidate(tactic) {
  const m = tactic.m ?? {};
  return tactic.on === true && m.class === 5 && m.learn === 1 && m.get === 3 && (m.copy ?? 0) === 0;
}

function band(id) {
  const n = Number(String(id).replace(/^t:/, ''));
  if (n < 10000) return '<10k';
  if (n < 20000) return '10k-19k';
  if (n < 30000) return '20k-29k';
  if (n < 100000) return '30k-99k';
  if (n < 800000) return '100k-799k';
  return '800k+';
}

function compact(t) {
  const m = t.m ?? {};
  return {
    id: t.id,
    name: t.name,
    chip: m.chip ?? null,
    special: m.special ?? null,
    class: m.class ?? null,
    type: m.type ?? null,
    learn: m.learn ?? null,
    get: m.get ?? null,
    copy: m.copy ?? null,
    band: band(t.id),
  };
}

test('inspect chip linkage for broad ownable tactic candidates', async () => {
  const seed = await readRegistrySeed();
  const uniqueIds = new Set(seed.generals.map((g) => g.ut).filter(Boolean));
  const candidates = seed.tactics.filter(isBroadCandidate).filter((t) => !uniqueIds.has(t.id));
  const withChip = candidates.filter((t) => Number(t.m?.chip ?? 0) > 0);
  const withoutChip = candidates.filter((t) => Number(t.m?.chip ?? 0) <= 0);
  const chipGroups = new Map();
  for (const tactic of withChip) {
    const chip = String(tactic.m.chip);
    const list = chipGroups.get(chip) ?? [];
    list.push(tactic);
    chipGroups.set(chip, list);
  }
  const duplicatedNames = [...new Set(candidates.map((t) => t.name))]
    .map((name) => ({ name, rows: candidates.filter((t) => t.name === name).map(compact) }))
    .filter((x) => x.rows.length > 1)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const duplicateChips = [...chipGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([chip, rows]) => ({ chip, rows: rows.map(compact) }));
  const byBand = Object.fromEntries([...new Set(candidates.map((t) => band(t.id)))].map((b) => [b, {
    total: candidates.filter((t) => band(t.id) === b).length,
    withChip: withChip.filter((t) => band(t.id) === b).length,
    withoutChip: withoutChip.filter((t) => band(t.id) === b).length,
  }]));
  console.log('TACTIC_CHIP_EVIDENCE_BEGIN');
  console.log(JSON.stringify({
    broadCandidateCount: candidates.length,
    withChipCount: withChip.length,
    withoutChipCount: withoutChip.length,
    distinctChipCount: chipGroups.size,
    duplicateChipCount: duplicateChips.length,
    byBand,
    duplicateChips,
    duplicatedNames,
    withChipFirst: withChip.slice(0, 40).map(compact),
    withoutChipFirst: withoutChip.slice(0, 40).map(compact),
  }, null, 2));
  console.log('TACTIC_CHIP_EVIDENCE_END');
  assert.ok(candidates.length > 0);
});
