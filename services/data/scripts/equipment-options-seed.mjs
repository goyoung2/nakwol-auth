import { readFile } from 'node:fs/promises';

const DEFAULT_SEED_URL = new URL('../seeds/equipment-options-v0.8.compact.json', import.meta.url);

export async function readEquipmentOptionsSeed(url = DEFAULT_SEED_URL) {
  const compact = JSON.parse(await readFile(url, 'utf8'));
  return expandEquipmentOptionsSeed(compact);
}

export function expandEquipmentOptionsSeed(compact) {
  if (compact?.version !== '0.8.0' || compact?.schema !== 3) {
    throw new Error('INVALID_EQUIPMENT_OPTIONS_SEED_VERSION');
  }
  if (!Array.isArray(compact.groups) || !Array.isArray(compact.applicability)) {
    throw new Error('INVALID_EQUIPMENT_OPTIONS_SEED_SHAPE');
  }

  const identities = [];
  const seen = new Set();
  for (const group of compact.groups) {
    if (!['skill', 'effect'].includes(group?.kind)
      || !Array.isArray(group?.ids)
      || typeof group?.name !== 'string'
      || group.name.trim() === ''
      || typeof group?.description !== 'string') {
      throw new Error('INVALID_EQUIPMENT_OPTIONS_SEED_GROUP');
    }
    for (const nativeId of group.ids) {
      if (!Number.isSafeInteger(nativeId) || nativeId <= 0) {
        throw new Error('INVALID_EQUIPMENT_OPTIONS_NATIVE_ID');
      }
      const id = `${group.kind === 'skill' ? 'ets' : 'ete'}:${nativeId}`;
      if (seen.has(id)) throw new Error(`DUPLICATE_EQUIPMENT_OPTIONS_ID:${id}`);
      seen.add(id);
      identities.push({
        id,
        native_id: nativeId,
        kind: group.kind,
        name: group.name,
        description: group.description,
        evidence_state: 'canonical',
      });
    }
  }
  identities.sort((left, right) => left.kind.localeCompare(right.kind) || left.native_id - right.native_id);

  const skillCount = identities.filter((row) => row.kind === 'skill').length;
  const effectCount = identities.filter((row) => row.kind === 'effect').length;
  const canonicalApplicability = compact.applicability.filter((row) => row?.evidence_state === 'canonical').length;
  const expected = compact.counts ?? {};
  if (skillCount !== expected.skills
    || effectCount !== expected.effects
    || identities.length !== expected.identities
    || canonicalApplicability !== expected.canonical_applicability) {
    throw new Error('EQUIPMENT_OPTIONS_SEED_COUNT_MISMATCH');
  }

  return {
    version: compact.version,
    schema: compact.schema,
    source: compact.source,
    counts: compact.counts,
    identities,
    applicability: compact.applicability,
  };
}
