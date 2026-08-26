import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';
import { DatabaseSync } from 'node:sqlite';
import { buildRegistrySql } from '../scripts/seed-registry.mjs';

const base = new URL('../', import.meta.url);
const seed = await readRegistrySeed();
const migration1 = await readFile(new URL('migrations/0001_initial.sql', base), 'utf8');
const migration2 = await readFile(new URL('migrations/0002_registry_v02.sql', base), 'utf8');

function count(db, table, where='1=1') { return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n; }

test('registry migration and seeder are idempotent and preserve user rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1); db.exec(migration2);
  const sql = buildRegistrySql(seed);
  assert.doesNotMatch(sql, /BEGIN(?: IMMEDIATE| TRANSACTION)?|COMMIT;/i);
  db.exec(sql);
  assert.equal(count(db,'game_generals'),209);
  assert.equal(count(db,'game_generals','enabled=1'),140);
  assert.equal(count(db,'game_tactics'),1077);
  assert.equal(count(db,'game_equipment_templates'),134);
  assert.equal(count(db,'game_stat_types'),281);
  assert.equal(count(db,'game_formations'),8);
  assert.equal(count(db,'game_warbooks'),442);
  assert.equal(db.prepare("SELECT unique_tactic_id FROM game_generals WHERE id='g:1000'").get().unique_tactic_id,'t:100001');
  const hidden = db.prepare("SELECT unique_tactic_id,metadata_json FROM game_generals WHERE id='g:1006'").get();
  assert.equal(hidden.unique_tactic_id,null);
  assert.equal(JSON.parse(hidden.metadata_json).unique_tactic_native_id,100601);

  db.exec("INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES ('usr_test',1,1); INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES ('gac_test','usr_test','테스트','5',1,1,1); INSERT INTO user_generals(account_id,general_id,owned,breakthrough,promotion,favorite,updated_at) VALUES ('gac_test','g:1000',1,5,2,1,1);");
  db.exec(sql);
  assert.equal(count(db,'user_generals'),1);
  assert.equal(db.prepare("SELECT breakthrough,promotion FROM user_generals WHERE account_id='gac_test' AND general_id='g:1000'").get().promotion,2);
  assert.equal(db.prepare("SELECT value FROM data_registry_meta WHERE key='seed_version'").get().value,'0.2.0');
  assert.equal(db.prepare("SELECT value FROM data_schema_meta WHERE key='schema_version'").get().value,'2');
});
