import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from './sqlite-d1.ts';
import { listEquipmentV08 } from '../src/equipment-store.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0003_equipment_options_v08.sql', import.meta.url), 'utf8')}`;

function withD1BoundParameterLimit(DB:any) {
  return {
    prepare(sql:string) {
      const statement = DB.prepare(sql);
      return {
        bind(...values:unknown[]) {
          if (values.length > 100) throw new Error(`D1_TOO_MANY_BOUND_PARAMETERS:${values.length}`);
          return statement.bind(...values);
        },
        first<T>() { return statement.first<T>(); },
        all<T>() { return statement.all<T>(); },
        run() { return statement.run(); },
      };
    },
    batch(statements:any[]) { return DB.batch(statements); },
  };
}

test('equipment listing does not exceed D1 100-bound-parameter query limit for large inventories', async () => {
  const DB = createSqliteD1(migration);
  const now = Date.now();
  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_a',now,now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run('gac_a','usr_a','테스터','5',now,now);
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','검',1,'{}')").run();
  const insert = DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?)');
  for (let index=0; index<101; index++) insert.run(`eqp_${String(index).padStart(3,'0')}`,'gac_a','w:1',null,now+index,now+index);

  const limitedDB = withD1BoundParameterLimit(DB);
  const rows = await listEquipmentV08({ DB:limitedDB } as any,'usr_a','gac_a');
  assert.equal(rows?.length,101);
  assert.ok(rows?.every((row)=>Array.isArray(row.traits)));
});
