import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from './sqlite-d1.ts';

const initial = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
const integrity = await readFile(new URL('../migrations/0006_deck_integrity.sql', import.meta.url), 'utf8');

function seedBase(DB:any){
  const now=Date.now();
  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_1',now,now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run('gac_1','usr_1','tester','1',now,now);
  for(const [id,name] of [['g:1','장수1'],['g:2','장수2'],['g:3','장수3']]) DB.raw.prepare("INSERT INTO game_generals(id,name,enabled,metadata_json) VALUES (?,?,1,'{}')").run(id,name);
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','무기',1,'{}')").run();
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('m:1','mount','탈것',1,'{}')").run();
  for(const [id,template] of [['eqp_w1','w:1'],['eqp_w2','w:1'],['eqp_m1','m:1'],['eqp_m2','m:1']]) DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,locked,favorite,created_at,updated_at) VALUES (?,?,?,0,0,?,?)').run(id,'gac_1',template,now,now);
  for(const id of ['dek_1','dek_2']) DB.raw.prepare("INSERT INTO decks(id,account_id,name,status,visibility,is_primary,created_at,updated_at) VALUES (?,?,'deck','active','private',0,?,?)").run(id,'gac_1',now,now);
}

test('deck integrity migration preserves valid rows and enforces deck-local uniqueness',()=>{
  const DB=createSqliteD1(`${initial}\n${integrity}`);
  seedBase(DB);

  DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES (?,?,?,?,?)').run('dek_1',1,'g:1','eqp_w1','eqp_m1');
  DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES (?,?,?,?,?)').run('dek_1',2,'g:2','eqp_w2','eqp_m2');
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM deck_general_slots WHERE deck_id=?').get('dek_1').n,2);

  assert.throws(()=>DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id) VALUES (?,?,?)').run('dek_1',3,'g:1'));
  assert.throws(()=>DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id) VALUES (?,?,?,?)').run('dek_1',3,'g:3','eqp_w1'));
  assert.throws(()=>DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,mount_instance_id) VALUES (?,?,?,?)').run('dek_1',3,'g:3','eqp_m1'));
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM deck_general_slots WHERE deck_id=?').get('dek_1').n,2);

  DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES (?,?,?,?,?)').run('dek_2',1,'g:1','eqp_w1','eqp_m1');
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM deck_general_slots WHERE deck_id=?').get('dek_2').n,1);
});

test('deck integrity migration can be applied again without changing valid rows',()=>{
  const DB=createSqliteD1(`${initial}\n${integrity}`);
  seedBase(DB);
  DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id,weapon_instance_id,mount_instance_id) VALUES (?,?,?,?,?)').run('dek_1',1,'g:1','eqp_w1','eqp_m1');
  DB.raw.exec(integrity);
  const row=DB.raw.prepare('SELECT general_id,weapon_instance_id,mount_instance_id FROM deck_general_slots WHERE deck_id=? AND position=1').get('dek_1') as any;
  assert.equal(row.general_id,'g:1');
  assert.equal(row.weapon_instance_id,'eqp_w1');
  assert.equal(row.mount_instance_id,'eqp_m1');
});
