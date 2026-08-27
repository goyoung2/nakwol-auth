import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const REQUIRED = [
  'data_schema_meta','data_registry_meta','data_users','data_applications','data_application_scopes',
  'game_accounts','game_generals','game_tactics','game_equipment_templates','game_stat_types',
  'game_equipment_traits','game_equipment_trait_applicability','game_promotion_items','game_seasons',
  'game_formations','game_warbooks','user_generals','user_tactics','user_promotion_items',
  'user_equipment','user_equipment_stats','user_equipment_traits','decks','deck_general_slots',
  'deck_tactic_slots','deck_settings','deck_snapshots',
];

const loadV02 = async () => `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}`;
const loadV03 = async () => readFile(new URL('../migrations/0003_equipment_options_v08.sql', import.meta.url), 'utf8');

async function applyCurrentSchema(db: DatabaseSync): Promise<void> {
  db.exec(await loadV02());
  db.exec(await loadV03());
}

function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((row) => String(row.name)));
}

test('migrations create the v0.8 schema 3 equipment evidence model', async () => {
  const db = new DatabaseSync(':memory:');
  await applyCurrentSchema(db);

  const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((row) => row.name));
  for (const table of REQUIRED) assert.equal(names.has(table), true, `missing ${table}`);

  assert.equal((db.prepare("SELECT value FROM data_schema_meta WHERE key='schema_version'").get() as any)?.value, '3');

  const traitColumns = columnNames(db, 'game_equipment_traits');
  for (const column of ['native_id', 'kind', 'evidence_state']) {
    assert.equal(traitColumns.has(column), true, `missing game_equipment_traits.${column}`);
  }

  db.prepare("INSERT INTO game_equipment_traits(id,name,equipment_type,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES ('ets:56','구주',NULL,'desc',1,'{}',56,'skill','canonical')").run();
  assert.throws(() => db.prepare("INSERT INTO game_equipment_traits(id,name,equipment_type,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES ('ets:56-copy','구주2',NULL,'desc',1,'{}',56,'skill','canonical')").run());

  db.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES ('ets:56','mount','observed','runtime:test','{}')").run();
  assert.throws(() => db.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES ('ets:56','armor','canonical','bad','{}')").run());
});

test('schema 3 migration preserves schema-2 user trait rows', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(await loadV02());
  const now = Date.now();
  db.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_test', now, now);
  db.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('gac_test','usr_test','tester','5',1,now,now);
  db.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','무기',1,'{}')").run();
  db.prepare("INSERT INTO game_equipment_traits(id,name,equipment_type,description,enabled,metadata_json) VALUES ('legacy:1','기존특기','any','기존',1,'{}')").run();
  db.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('eqp_legacy','gac_test','w:1',null,0,0,now,now);
  db.prepare("INSERT INTO user_equipment_traits(equipment_id,slot,trait_id) VALUES ('eqp_legacy',1,'legacy:1')").run();

  db.exec(await loadV03());

  assert.equal((db.prepare("SELECT value FROM data_schema_meta WHERE key='schema_version'").get() as any)?.value, '3');
  assert.equal((db.prepare("SELECT trait_id FROM user_equipment_traits WHERE equipment_id='eqp_legacy' AND slot=1").get() as any)?.trait_id, 'legacy:1');
  assert.equal((db.prepare("SELECT evidence_state FROM game_equipment_traits WHERE id='legacy:1'").get() as any)?.evidence_state, 'unresolved');
});

test('migration enforces permanent asset bounds', async () => {
  const db = new DatabaseSync(':memory:');
  await applyCurrentSchema(db);
  const now = Date.now();
  db.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_test',now,now);
  db.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('gac_test','usr_test','tester','5',1,now,now);
  db.prepare("INSERT INTO game_generals(id,name,enabled,metadata_json) VALUES (?,?,1,'{}')").run('g','장수');
  db.prepare("INSERT INTO game_tactics(id,name,enabled,metadata_json) VALUES (?,?,1,'{}')").run('t','전법');
  assert.throws(() => db.prepare('INSERT INTO user_generals(account_id,general_id,owned,breakthrough,promotion,favorite,updated_at) VALUES (?,?,1,6,0,0,?)').run('gac_test','g',now));
  assert.throws(() => db.prepare('INSERT INTO user_tactics(account_id,tactic_id,owned,breakthrough,favorite,updated_at) VALUES (?,?,1,-1,0,?)').run('gac_test','t',now));
});
