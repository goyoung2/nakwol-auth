import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { writeRegistrySeedParts } from './registry-seed-file.mjs';

function readJson(path) { return readFile(path, 'utf8').then(JSON.parse); }
function locatorPattern(rows) {
  const locator = rows[0]?.source_locator ?? '';
  return locator.replace(/\d+$/, '{native_id}');
}
function sourceSummary(rows, fileHash) {
  return {
    evidence: [...new Set(rows.map((row) => row.evidence_level).filter(Boolean))].sort(),
    source_hashes: fileHash ? [fileHash] : [],
    locator_pattern: locatorPattern(rows),
  };
}
function num(value) { return value == null ? null : Number(value); }

export async function buildRegistrySeed(catalogDir) {
  const names = ['manifest','heroes','skills','equipment','horses','attributes','formations','warbooks'];
  const loaded = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readJson(join(catalogDir, `${name}.json`))])));
  const { manifest } = loaded;
  const fileHashes = Object.fromEntries((manifest.files ?? []).map((entry) => [entry.path, entry.sha256]));
  const heroes = loaded.heroes.rows;
  const skills = loaded.skills.rows;
  const equipment = loaded.equipment.rows;
  const horses = loaded.horses.rows;
  const attributes = loaded.attributes.rows;
  const formations = loaded.formations.rows;
  const warbooks = loaded.warbooks.rows;
  const tacticIds = new Set(skills.map((row) => Number(row.native_id)));

  const tactics = skills.map((row) => {
    const f = row.fields ?? {}; const raw = f.raw_fields ?? {}; const n = Number(row.native_id);
    return { id:`t:${n}`, n, name:row.name_ko ?? String(f.skill_name ?? n), cat:f.skill_type_normalized ?? null,
      rar:raw.quality ?? null, on:true,
      m:{ class:f.skill_class_raw ?? null, type:f.skill_type_raw ?? null, special:f.special_type_raw ?? null,
        prob:f.probability ?? null, prep:f.preparation_turns ?? null, chip:raw.chip_id ?? null,
        learn:raw.learn_times ?? null, get:raw.get_type ?? null, copy:raw.is_copy ?? null } };
  }).sort((a,b) => a.n - b.n);

  const generals = heroes.map((row) => {
    const f = row.fields ?? {}; const raw = f.raw_fields ?? {}; const n = Number(row.native_id); const utn = num(f.init_skill_id);
    return { id:`g:${n}`, n, name:row.name_ko ?? String(f.hero_name ?? n), ut:utn != null && tacticIds.has(utn) ? `t:${utn}` : null,
      rar:f.quality ?? null, on:raw.is_show === 1,
      m:{ show:raw.is_show ?? null, official:raw.official ?? null, story:raw.is_story ?? null, custom:raw.is_custom ?? null,
        camp:f.camp ?? null, soldier:f.soldier_type ?? null, utn, utname:f.init_skill_name ?? null, uttype:f.init_skill_type ?? null,
        stats:[f.force ?? null,f.intelligence ?? null,f.command ?? null,f.speed ?? null],
        growth:[f.growth_force ?? null,f.growth_intelligence ?? null,f.growth_command ?? null,f.growth_speed ?? null] } };
  }).sort((a,b) => a.n - b.n);

  function itemRows(rows, type, prefix) {
    return rows.map((row) => { const f=row.fields ?? {}; const n=Number(row.native_id); return {
      id:`${prefix}:${n}`, n, type, name:row.name_ko ?? String(f.name ?? n), on:true,
      m:{ rar:f.raity ?? null, desc:f.description ?? null, icon:f.icon_name ?? null, raw_type:f.type ?? null }
    }; });
  }
  const itemSeed = [...itemRows(equipment,'weapon','w'), ...itemRows(horses,'mount','m')]
    .sort((a,b) => a.type.localeCompare(b.type) || a.n-b.n);

  const statTypes = attributes.map((row) => { const f=row.fields ?? {}; const n=Number(row.native_id); return {
    id:`s:${n}`, n, name:row.name_ko ?? String(f.Name ?? n), on:true,
    m:{ en:f.Ename ?? null, display:f.Display ?? null, prop:f.prop_type ?? null, replay:f.replay_fightprop_type ?? null,
      initial:f.Initial ?? null, min:f.Min ?? null, max:f.Max ?? null }
  }; }).sort((a,b) => a.n-b.n);

  const formationSeed = formations.map((row) => { const f=row.fields ?? {}; const n=Number(row.native_id); return {
    id:`f:${n}`, n, name:row.name_ko ?? String(f.formation_name ?? n), desc:f.desc_kr ?? null, on:true,
    m:{ field:f.field ?? null, character:f.character_kr ?? null, position:f.position ?? null,
      effects:Array.isArray(f.effects) ? f.effects.map((e) => ({slot:e.effect_slot ?? null,type:e.effect_type ?? null,value:e.effect_value ?? null,formula:e.effect_formula_raw ?? null})) : [] }
  }; }).sort((a,b) => a.n-b.n);

  const warbookSeed = warbooks.map((row) => { const f=row.fields ?? {}; const n=Number(row.native_id); const related=num(f.related_skill_id); return {
    id:`b:${n}`, n, name:row.name_ko ?? String(f.warbook_name ?? n), q:f.quality ?? null, type:f.type ?? null,
    rt:related != null && tacticIds.has(related) ? `t:${related}` : null, desc:f.description ?? null, on:true,
    m:{ skill_type:f.skill_type ?? null, related_native:related, ex:f.is_ex ?? null, group:f.group_id ?? null,
      slot_rule:f.slot_rule ?? null, unlock:f.unlock_level_candidates ?? [], tags:f.effect_tags ?? [] }
  }; }).sort((a,b) => a.n-b.n);

  return {
    v:'0.2.0', schema:2,
    source:{ dataset:manifest.dataset, lifecycle:manifest.lifecycle, season_boundary:manifest.season_boundary,
      identity_rule:manifest.identity_rule,
      sources:{ heroes:sourceSummary(heroes,fileHashes['heroes.json']), skills:sourceSummary(skills,fileHashes['skills.json']), equipment:sourceSummary(equipment,fileHashes['equipment.json']), horses:sourceSummary(horses,fileHashes['horses.json']),
        attributes:sourceSummary(attributes,fileHashes['attributes.json']), formations:sourceSummary(formations,fileHashes['formations.json']), warbooks:sourceSummary(warbooks,fileHashes['warbooks.json']) } },
    counts:{ generals:generals.length, generals_enabled:generals.filter((r)=>r.on).length, tactics:tactics.length,
      equipment:itemSeed.length, weapons:equipment.length, mounts:horses.length, stat_types:statTypes.length,
      formations:formationSeed.length, warbooks:warbookSeed.length },
    generals, tactics, equipment:itemSeed, stat_types:statTypes, formations:formationSeed, warbooks:warbookSeed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalogDir = resolve(process.argv[2] ?? '.');
  const output = resolve(process.argv[3] ?? 'seeds/registry-v0.2.parts');
  const seed = await buildRegistrySeed(catalogDir);
  const { body, compressed, parts } = await writeRegistrySeedParts(seed, output);
  console.log(`NAKWOL_DATA_REGISTRY_SEED_READY:${createHash('sha256').update(body).digest('hex')}:${compressed.length}:${parts}`);
}
