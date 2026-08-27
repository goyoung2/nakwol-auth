import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';
import { readEquipmentOptionsSeed } from '../scripts/equipment-options-seed.mjs';
import { DatabaseSync } from 'node:sqlite';
import { buildRegistrySql } from '../scripts/seed-registry.mjs';

const base = new URL('../', import.meta.url);
const seed = await readRegistrySeed();
const equipmentOptionsSeed = await readEquipmentOptionsSeed();
const migration1 = await readFile(new URL('migrations/0001_initial.sql', base), 'utf8');
const migration2 = await readFile(new URL('migrations/0002_registry_v02.sql', base), 'utf8');
const migration3 = await readFile(new URL('migrations/0003_equipment_options_v08.sql', base), 'utf8');

function count(db, table, where='1=1') { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n; }

test('registry migration and seeder are idempotent and preserve user rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1); db.exec(migration2); db.exec(migration3);
  const sql = buildRegistrySql(seed, equipmentOptionsSeed);
  assert.doesNotMatch(sql, /BEGIN(?: IMMEDIATE| TRANSACTION)?|COMMIT;/i);
  db.exec(sql);
  assert.equal(count(db,'game_generals'),209);
  assert.equal(count(db,'game_generals','enabled=1'),140);
  assert.equal(count(db,'game_tactics'),1077);
  assert.equal(count(db,'game_equipment_templates'),134);
  assert.equal(count(db,'game_stat_types'),281);
  assert.equal(count(db,'game_formations'),8);
  assert.equal(count(db,'game_warbooks'),442);
  assert.equal(count(db,'game_equipment_traits'),180);
  assert.equal(count(db,'game_equipment_traits',"kind='skill' AND evidence_state='canonical'"),106);
  assert.equal(count(db,'game_equipment_traits',"kind='effect' AND evidence_state='canonical'"),74);
  assert.equal(count(db,'game_equipment_trait_applicability'),0);
  assert.equal(db.prepare("SELECT unique_tactic_id FROM game_generals WHERE id='g:1000'").get().unique_tactic_id,'t:100001');
  const hidden = db.prepare("SELECT unique_tactic_id,metadata_json FROM game_generals WHERE id='g:1006'").get();
  assert.equal(hidden.unique_tactic_id,null);
  assert.equal(JSON.parse(hidden.metadata_json).unique_tactic_native_id,100601);

  const guju = db.prepare("SELECT native_id,kind,name,evidence_state FROM game_equipment_traits WHERE id='ets:56'").get();
  assert.equal(guju.native_id,56);
  assert.equal(guju.kind,'skill');
  assert.equal(guju.name,'구주');
  assert.equal(guju.evidence_state,'canonical');
  const projection = db.prepare("SELECT native_id,kind,name,evidence_state FROM game_equipment_traits WHERE id='ete:54'").get();
  assert.equal(projection.native_id,54);
  assert.equal(projection.kind,'effect');
  assert.equal(projection.name,'투영');
  assert.equal(projection.evidence_state,'canonical');

  db.exec("INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES ('usr_test',1,1); INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES ('gac_test','usr_test','테스트','5',1,1,1); INSERT INTO user_generals(account_id,general_id,owned,breakthrough,promotion,favorite,updated_at) VALUES ('gac_test','g:1000',1,5,2,1,1);");
  const templateId = db.prepare("SELECT id FROM game_equipment_templates WHERE type='weapon' ORDER BY id LIMIT 1").get().id;
  db.prepare("INSERT INTO user_equipment(id,account_id,template_id,locked,favorite,created_at,updated_at) VALUES ('eqp_seed_guard','gac_test',?,0,0,1,1)").run(templateId);
  db.exec("INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES ('eqp_seed_guard',1,'ets:56');");

  db.exec(sql);
  assert.equal(count(db,'user_generals'),1);
  assert.equal(db.prepare("SELECT breakthrough,promotion FROM user_generals WHERE account_id='gac_test' AND general_id='g:1000'").get().promotion,2);
  assert.equal(db.prepare("SELECT trait_id FROM user_equipment_traits WHERE equipment_id='eqp_seed_guard' AND slot=1").get().trait_id,'ets:56');
  assert.equal(db.prepare("SELECT value FROM data_registry_meta WHERE key='seed_version'").get().value,'0.2.0');
  assert.equal(db.prepare("SELECT value FROM data_registry_meta WHERE key='equipment_options_seed_version'").get().value,'0.8.0');
  assert.equal(db.prepare("SELECT value FROM data_schema_meta WHERE key='schema_version'").get().value,'3');
});
