import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import app from '../src/index.ts';
import { normalizeReplaceCompositionInput } from '../src/decks-domain.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const migration = `${await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')}\n${await readFile(new URL('../migrations/0002_registry_v02.sql', import.meta.url), 'utf8')}`;
const ctx = { waitUntil() {}, passThroughOnException() {} };

function req(path:string,init:RequestInit={}) {
  const headers=new Headers(init.headers);
  headers.set('Authorization','Bearer token');
  headers.set('X-NAKWOL-CLIENT-ID','deck-integrity-test');
  headers.set('Origin','https://deck-integrity.example');
  return new Request(`https://data.example${path}`,{...init,headers});
}

function grant(DB:any,scope:string) {
  const now=Date.now();
  DB.raw.prepare('INSERT OR IGNORE INTO data_applications(client_id,status,created_at,updated_at) VALUES (?,?,?,?)').run('deck-integrity-test','active',now,now);
  DB.raw.prepare('INSERT OR IGNORE INTO data_application_scopes(client_id,scope,created_at) VALUES (?,?,?)').run('deck-integrity-test',scope,now);
}

function seed(DB:any) {
  const now=Date.now();
  DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run('usr_owner',now,now);
  DB.raw.prepare('INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run('gac_owner','usr_owner','owner','5',now,now);
  DB.raw.prepare("INSERT INTO decks(id,account_id,name,status,visibility,is_primary,created_at,updated_at) VALUES (?,?,?,'active','private',0,?,?)").run('dek_integrity','gac_owner','무결성 테스트',now,now);
  for (const [id,name] of [['g:old','기존장수'],['g:a','장수A'],['g:b','장수B'],['g:c','장수C']]) {
    DB.raw.prepare("INSERT INTO game_generals(id,name,enabled,metadata_json) VALUES (?,?,1,'{}')").run(id,name);
  }
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('w:1','weapon','테스트무기',1,'{}')").run();
  DB.raw.prepare("INSERT INTO game_equipment_templates(id,type,name,enabled,metadata_json) VALUES ('m:1','mount','테스트탈것',1,'{}')").run();
  DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?)').run('eqp_weapon','gac_owner','w:1','무기1',now,now);
  DB.raw.prepare('INSERT INTO user_equipment(id,account_id,template_id,nickname,locked,favorite,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?)').run('eqp_mount','gac_owner','m:1','탈것1',now,now);
  DB.raw.prepare('INSERT INTO deck_general_slots(deck_id,position,general_id) VALUES (?,?,?)').run('dek_integrity',1,'g:old');
  grant(DB,'decks:write');
  grant(DB,'decks:read');
}

function authFetcher() {
  return async()=>Response.json({ok:true,data:{id:'usr_owner',display_name:'owner',avatar_url:null,membership:{role:'member'}}});
}

async function call(request:Request,env:any) {
  const original=globalThis.fetch;
  globalThis.fetch=authFetcher() as typeof fetch;
  try { return await (app as any).fetch(request,env,ctx); }
  finally { globalThis.fetch=original; }
}

async function putComposition(env:any,generals:any[]) {
  return call(req('/v1/game-accounts/gac_owner/decks/dek_integrity/composition',{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({generals}),
  }),env);
}

async function assertOldCompositionStillStored(env:any) {
  const response=await call(req('/v1/game-accounts/gac_owner/decks/dek_integrity'),env);
  assert.equal(response.status,200);
  const deck=(await response.json() as any).data;
  assert.equal(deck.generals.length,1);
  assert.equal(deck.generals[0].position,1);
  assert.equal(deck.generals[0].general_id,'g:old');
  assert.equal(deck.generals[0].weapon,null);
  assert.equal(deck.generals[0].mount,null);
}

test('composition normalization rejects duplicate general ids and equipment ids across the whole deck',()=>{
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[
    {position:1,general_id:'g:a'},
    {position:2,general_id:'g:a'},
  ]}),/DUPLICATE_GENERAL_IN_DECK/);

  assert.throws(()=>normalizeReplaceCompositionInput({generals:[
    {position:1,general_id:'g:a',weapon_instance_id:'eqp_weapon'},
    {position:2,general_id:'g:b',weapon_instance_id:'eqp_weapon'},
  ]}),/DUPLICATE_EQUIPMENT_IN_DECK/);

  assert.throws(()=>normalizeReplaceCompositionInput({generals:[
    {position:1,general_id:'g:a',mount_instance_id:'eqp_mount'},
    {position:2,general_id:'g:b',mount_instance_id:'eqp_mount'},
  ]}),/DUPLICATE_EQUIPMENT_IN_DECK/);

  assert.throws(()=>normalizeReplaceCompositionInput({generals:[
    {position:1,general_id:'g:a',weapon_instance_id:'eqp_weapon'},
    {position:2,general_id:'g:b',mount_instance_id:'eqp_weapon'},
  ]}),/DUPLICATE_EQUIPMENT_IN_DECK/);
});

test('composition API rejects duplicate generals before mutation and preserves the previous composition',async()=>{
  const DB=createSqliteD1(migration); seed(DB); const env={DB,AUTH_ORIGIN:'https://auth.example'} as any;
  const response=await putComposition(env,[
    {position:1,general_id:'g:a'},
    {position:2,general_id:'g:a'},
  ]);
  assert.equal(response.status,400);
  assert.equal((await response.json() as any).error.code,'DUPLICATE_GENERAL_IN_DECK');
  await assertOldCompositionStillStored(env);
});

test('composition API rejects duplicate weapon or mount instances before mutation',async()=>{
  const cases=[
    [
      {position:1,general_id:'g:a',weapon_instance_id:'eqp_weapon'},
      {position:2,general_id:'g:b',weapon_instance_id:'eqp_weapon'},
    ],
    [
      {position:1,general_id:'g:a',mount_instance_id:'eqp_mount'},
      {position:2,general_id:'g:b',mount_instance_id:'eqp_mount'},
    ],
    [
      {position:1,general_id:'g:a',weapon_instance_id:'eqp_weapon'},
      {position:2,general_id:'g:b',mount_instance_id:'eqp_weapon'},
    ],
  ];

  for (const generals of cases) {
    const DB=createSqliteD1(migration); seed(DB); const env={DB,AUTH_ORIGIN:'https://auth.example'} as any;
    const response=await putComposition(env,generals);
    assert.equal(response.status,400);
    assert.equal((await response.json() as any).error.code,'DUPLICATE_EQUIPMENT_IN_DECK');
    await assertOldCompositionStillStored(env);
  }
});
