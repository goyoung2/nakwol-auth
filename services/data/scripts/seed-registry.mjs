import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegistrySeed } from './registry-seed-file.mjs';
import { readEquipmentOptionsSeed } from './equipment-options-seed.mjs';

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}
function bool(value) { return value ? 1 : 0; }
function metadata(domain, row) {
  const base = { native_id: row.n, source_domain: domain };
  if (domain === 'heroes') return JSON.stringify({ ...base,
    is_show:row.m.show, official:row.m.official, is_story:row.m.story, is_custom:row.m.custom,
    camp:row.m.camp, soldier_type:row.m.soldier, unique_tactic_native_id:row.m.utn,
    unique_tactic_name:row.m.utname, unique_tactic_type:row.m.uttype,
    stats:{force:row.m.stats?.[0]??null,intelligence:row.m.stats?.[1]??null,command:row.m.stats?.[2]??null,speed:row.m.stats?.[3]??null},
    growth:{force:row.m.growth?.[0]??null,intelligence:row.m.growth?.[1]??null,command:row.m.growth?.[2]??null,speed:row.m.growth?.[3]??null},
    availability_status:row.on?'visible':'hidden' });
  if (domain === 'skills') return JSON.stringify({ ...base, skill_class_raw:row.m.class, skill_type_raw:row.m.type,
    special_type_raw:row.m.special, probability:row.m.prob, preparation_turns:row.m.prep, chip_id:row.m.chip,
    learn_times:row.m.learn, get_type:row.m.get, is_copy:row.m.copy, ownership_status:'unclassified' });
  if (domain === 'equipment' || domain === 'horses') return JSON.stringify({ ...base, rarity:row.m.rar,
    description:row.m.desc, icon_name:row.m.icon, raw_type:row.m.raw_type });
  if (domain === 'attributes') return JSON.stringify({ ...base, ename:row.m.en, display:row.m.display, prop_type:row.m.prop,
    replay_fightprop_type:row.m.replay, initial:row.m.initial, min:row.m.min, max:row.m.max, usage_status:'unclassified' });
  if (domain === 'formations') return JSON.stringify({ ...base, field:row.m.field, character:row.m.character,
    position:row.m.position, effects:row.m.effects });
  if (domain === 'warbooks') return JSON.stringify({ ...base, skill_type:row.m.skill_type, related_skill_native_id:row.m.related_native,
    is_ex:row.m.ex, group_id:row.m.group, slot_rule:row.m.slot_rule, unlock_level_candidates:row.m.unlock, effect_tags:row.m.tags });
  return JSON.stringify({ ...base, ...row.m });
}
function upsert(table, columns, values, updateColumns=columns.filter((c)=>c!=='id')) {
  return `INSERT INTO ${table}(${columns.join(',')}) VALUES (${values.map(sqlValue).join(',')}) ON CONFLICT(id) DO UPDATE SET ${updateColumns.map((c)=>`${c}=excluded.${c}`).join(',')};`;
}
function equipmentOptionMetadata(seed, row) {
  return JSON.stringify({
    native_id: row.native_id,
    source_domain: row.kind === 'skill' ? 'equipment_skill' : 'equipment_effect',
    evidence_state: row.evidence_state,
    source_repository: seed.source.repository,
    source_path: seed.source.path,
    source_blob_sha: seed.source.blob_sha,
    source_projection: seed.source.projection,
  });
}

export function buildRegistrySql(seed, equipmentOptionsSeed = null) {
  const lines = ['PRAGMA foreign_keys = ON;'];
  for (const row of seed.tactics) lines.push(upsert('game_tactics',['id','name','category','rarity','enabled','metadata_json'],[row.id,row.name,row.cat,row.rar,bool(row.on),metadata('skills',row)]));
  for (const row of seed.generals) lines.push(upsert('game_generals',['id','name','unique_tactic_id','rarity','enabled','metadata_json'],[row.id,row.name,row.ut,row.rar,bool(row.on),metadata('heroes',row)]));
  for (const row of seed.equipment) lines.push(upsert('game_equipment_templates',['id','type','name','enabled','metadata_json'],[row.id,row.type,row.name,bool(row.on),metadata(row.type==='weapon'?'equipment':'horses',row)]));
  for (const row of seed.stat_types) lines.push(upsert('game_stat_types',['id','name','enabled','metadata_json'],[row.id,row.name,bool(row.on),metadata('attributes',row)]));
  for (const row of seed.formations) lines.push(upsert('game_formations',['id','name','description','enabled','metadata_json'],[row.id,row.name,row.desc,bool(row.on),metadata('formations',row)]));
  for (const row of seed.warbooks) lines.push(upsert('game_warbooks',['id','name','quality','type','related_tactic_id','description','enabled','metadata_json'],[row.id,row.name,row.q,row.type,row.rt,row.desc,bool(row.on),metadata('warbooks',row)]));

  if (equipmentOptionsSeed) {
    for (const row of equipmentOptionsSeed.identities) {
      lines.push(upsert(
        'game_equipment_traits',
        ['id','name','equipment_type','description','enabled','metadata_json','native_id','kind','evidence_state'],
        [row.id,row.name,null,row.description,1,equipmentOptionMetadata(equipmentOptionsSeed,row),row.native_id,row.kind,row.evidence_state],
      ));
    }
    for (const row of equipmentOptionsSeed.applicability) {
      lines.push(`INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES (${sqlValue(row.trait_id)},${sqlValue(row.equipment_type)},${sqlValue(row.evidence_state)},${sqlValue(row.source_locator)},${sqlValue(row.metadata_json ?? {})}) ON CONFLICT(trait_id,equipment_type) DO UPDATE SET evidence_state=excluded.evidence_state,source_locator=excluded.source_locator,metadata_json=excluded.metadata_json;`);
    }
  }

  const now = 0;
  const metaRows = [
    ['seed_version', seed.v],
    ['source_json', JSON.stringify(seed.source)],
    ['source_counts_json', JSON.stringify(seed.counts)],
  ];
  if (equipmentOptionsSeed) {
    metaRows.push(
      ['equipment_options_seed_version', equipmentOptionsSeed.version],
      ['equipment_options_source_json', JSON.stringify(equipmentOptionsSeed.source)],
      ['equipment_options_counts_json', JSON.stringify(equipmentOptionsSeed.counts)],
    );
  }
  for (const [key,value] of metaRows) lines.push(`INSERT INTO data_registry_meta(key,value,updated_at) VALUES (${sqlValue(key)},${sqlValue(value)},${now}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const mode = process.argv.includes('--remote') ? '--remote' : '--local';
  const [seed, equipmentOptionsSeed] = await Promise.all([
    readRegistrySeed(),
    readEquipmentOptionsSeed(),
  ]);
  const dir = await mkdtemp(join(tmpdir(),'nakwol-data-registry-'));
  const sqlPath = join(dir,'registry.sql');
  try {
    await writeFile(sqlPath, buildRegistrySql(seed, equipmentOptionsSeed));
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npx,['wrangler','d1','execute','DB',mode,`--file=${sqlPath}`],{stdio:'inherit'});
    if (result.status !== 0) process.exit(result.status ?? 1);
    console.log(`NAKWOL_DATA_REGISTRY_SEEDED:${seed.v}:${mode}`);
    console.log(`NAKWOL_DATA_EQUIPMENT_OPTIONS_SEEDED:${equipmentOptionsSeed.version}:${mode}`);
  } finally { await rm(dir,{recursive:true,force:true}); }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
