import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from './sqlite-d1.ts';
import { createEquipmentV08 } from '../src/equipment-store.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0003_equipment_options_v08.sql', import.meta.url), 'utf8')}`;

function baseDb() {
  const DB = createSqliteD1(migration);
  const now = Date.now();
  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_a', now, now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run('gac_a','usr_a','테스터','5',now,now);
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','검',1,'{}')").run();
  return DB;
}

function addApplicability(DB:any, traitId:string) {
  DB.raw.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES (?,'weapon','canonical','test','{}')").run(traitId);
}

test('canonical write authority requires complete kind/native-id/stable-id identity, not evidence label alone', async () => {
  for (const row of [
    { id:'legacy:null-kind', nativeId:56, kind:null },
    { id:'legacy:null-native', nativeId:null, kind:'skill' },
    { id:'legacy:wrong-id', nativeId:56, kind:'skill' },
  ] as const) {
    const DB = baseDb();
    DB.raw.prepare("INSERT INTO game_equipment_traits(id,name,equipment_type,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES (?,?,NULL,'설명',1,'{}',?,?,'canonical')")
      .run(row.id,'형식불완전',row.nativeId,row.kind);
    addApplicability(DB,row.id);

    const result = await createEquipmentV08({ DB } as any,'usr_a','gac_a',{
      templateId:'w:1', nickname:null, locked:false, favorite:false,
      traits:[{ slot:1, traitId:row.id }],
    });
    assert.equal(result.kind,'trait_unverified',row.id);
    assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM user_equipment').get().n,0);
  }
});
