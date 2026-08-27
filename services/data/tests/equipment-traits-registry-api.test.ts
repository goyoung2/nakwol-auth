import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from './sqlite-d1.ts';
import { handleRegistryList } from '../src/routes/registry.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0003_equipment_options_v08.sql', import.meta.url), 'utf8')}`;

const authFetcher = () => async () => Response.json({ ok:true, data:{ id:'usr_traits', display_name:'테스터', avatar_url:null, membership:{ role:'member' } } });
function req() {
  return new Request('https://data.example/v1/registry/equipment-traits', { headers:{ Authorization:'Bearer token', 'X-NAKWOL-CLIENT-ID':'trait-lab', Origin:'https://trait-lab.pages.dev' } });
}
function grant(DB:any, scope:string) {
  DB.raw.prepare("INSERT INTO data_applications(client_id,status,created_at,updated_at) VALUES ('trait-lab','active',1,1)").run();
  DB.raw.prepare("INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES ('trait-lab',?,1)").run(scope);
}

test('equipment trait Registry is equipment:read protected and exposes identity/applicability evidence separately', async () => {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN:'https://auth.example' } as any;
  DB.raw.prepare("INSERT INTO game_equipment_traits(id,name,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES ('ets:56','구주','통솔 증가',1,'{}',56,'skill','canonical')").run();
  DB.raw.prepare("INSERT INTO game_equipment_traits(id,name,description,enabled,metadata_json,native_id,kind,evidence_state) VALUES ('ete:54','투영','주는 피해 증가',1,'{}',54,'effect','canonical')").run();
  DB.raw.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES ('ets:56','mount','observed','battle:1','{}')").run();
  DB.raw.prepare("INSERT INTO game_equipment_trait_applicability(trait_id,equipment_type,evidence_state,source_locator,metadata_json) VALUES ('ete:54','weapon','canonical','client:rule','{}')").run();

  let response = await handleRegistryList('equipment_traits' as any, req(), env, authFetcher());
  assert.equal(response.status, 403);

  grant(DB, 'equipment:read');
  response = await handleRegistryList('equipment_traits' as any, req(), env, authFetcher());
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 2);

  const guju = body.data.find((row:any) => row.id === 'ets:56');
  assert.equal(guju.native_id, 56);
  assert.equal(guju.kind, 'skill');
  assert.equal(guju.name, '구주');
  assert.equal(guju.evidence_state, 'canonical');
  assert.deepEqual(guju.applicability, [{ equipment_type:'mount', evidence_state:'observed', source_locator:'battle:1', metadata:{} }]);

  const projection = body.data.find((row:any) => row.id === 'ete:54');
  assert.equal(projection.kind, 'effect');
  assert.deepEqual(projection.applicability, [{ equipment_type:'weapon', evidence_state:'canonical', source_locator:'client:rule', metadata:{} }]);
});
