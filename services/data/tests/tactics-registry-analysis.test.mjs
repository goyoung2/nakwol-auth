import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';

function isOwnableTactic(tactic, uniqueIds) {
  const m = tactic.m ?? {};
  return tactic.on === true
    && m.class === 5
    && m.learn === 1
    && m.get === 3
    && (m.copy ?? 0) === 0
    && Number(m.chip ?? 0) > 0
    && !uniqueIds.has(tactic.id);
}

test('authoritative Registry has 146 canonical user-ownable tactics linked 1:1 to chips', async () => {
  const seed = await readRegistrySeed();
  const uniqueIds = new Set(seed.generals.map((g) => g.ut).filter(Boolean));
  const ownable = seed.tactics.filter((t) => isOwnableTactic(t, uniqueIds));
  const chips = ownable.map((t) => Number(t.m.chip));

  assert.equal(ownable.length, 146);
  assert.equal(new Set(chips).size, 146);
  assert.ok(ownable.every((t) => t.m.special === 0));
  assert.ok(ownable.every((t) => !String(t.id).startsWith('t:810')));
  assert.ok(ownable.some((t) => t.id === 't:20010' && t.name === '문무겸비'));
});

test('known duplicate/internal tactic variants are not canonical owned-tactic records', async () => {
  const seed = await readRegistrySeed();
  const uniqueIds = new Set(seed.generals.map((g) => g.ut).filter(Boolean));
  const byId = new Map(seed.tactics.map((t) => [t.id, t]));

  for (const id of ['t:7569', 't:17703', 't:810055', 't:600002']) {
    const tactic = byId.get(id);
    assert.ok(tactic, `missing fixture ${id}`);
    assert.equal(isOwnableTactic(tactic, uniqueIds), false, `${id} must stay non-ownable`);
  }
  assert.equal(isOwnableTactic(byId.get('t:20350'), uniqueIds), true);
});
