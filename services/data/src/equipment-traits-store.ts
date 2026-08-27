import type { DataEnv } from './types.ts';

type TraitRow = {
  id:string;
  native_id:number|null;
  kind:'skill'|'effect'|null;
  name:string;
  description:string|null;
  evidence_state:'canonical'|'observed'|'unresolved';
  metadata_json:string;
};

type ApplicabilityRow = {
  trait_id:string;
  equipment_type:'weapon'|'mount';
  evidence_state:'canonical'|'observed'|'unresolved';
  source_locator:string|null;
  metadata_json:string;
};

function parseMetadata(value:string):Record<string,unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string,unknown>
      : {};
  } catch {
    return {};
  }
}

export async function listEquipmentTraitsRegistry(env:Pick<DataEnv,'DB'>) {
  const [traitsResult, applicabilityResult] = await Promise.all([
    env.DB.prepare(`SELECT id, native_id, kind, name, description, evidence_state, metadata_json FROM game_equipment_traits WHERE enabled = 1 ORDER BY kind, name, id`).all<TraitRow>(),
    env.DB.prepare(`SELECT trait_id, equipment_type, evidence_state, source_locator, metadata_json FROM game_equipment_trait_applicability ORDER BY trait_id, equipment_type`).all<ApplicabilityRow>(),
  ]);

  const applicability = new Map<string, Array<{
    equipment_type:'weapon'|'mount';
    evidence_state:'canonical'|'observed'|'unresolved';
    source_locator:string|null;
    metadata:Record<string,unknown>;
  }>>();
  for (const row of applicabilityResult.results || []) {
    const rows = applicability.get(row.trait_id) ?? [];
    rows.push({
      equipment_type:row.equipment_type,
      evidence_state:row.evidence_state,
      source_locator:row.source_locator,
      metadata:parseMetadata(row.metadata_json),
    });
    applicability.set(row.trait_id, rows);
  }

  return (traitsResult.results || []).map((row) => ({
    id:row.id,
    native_id:row.native_id,
    kind:row.kind,
    name:row.name,
    description:row.description,
    evidence_state:row.evidence_state,
    applicability:applicability.get(row.id) ?? [],
    metadata:parseMetadata(row.metadata_json),
  }));
}
