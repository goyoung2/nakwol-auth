import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { registerRoleAdminRoutes } from '../../src/role-admin';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

const season = '1553600098661957643';
const subdivision = '1553600098661957644';
const guild = '1493410906456064112';

async function fixture(beforeRun?: (sql: string, db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE applications(client_id TEXT PRIMARY KEY, name TEXT, redirect_uris TEXT DEFAULT '[]', updated_at INTEGER DEFAULT 0);
    CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE application_settings(client_id TEXT PRIMARY KEY, access_policy TEXT);
    CREATE TABLE auth_operators(user_id TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE access_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,client_id TEXT,expires_at INTEGER,revoked_at INTEGER,created_at INTEGER);
    CREATE TABLE user_reauthentication(user_id TEXT PRIMARY KEY,requested_at INTEGER);
    CREATE TABLE auth_events(id TEXT,user_id TEXT,client_id TEXT,event_type TEXT,detail TEXT,created_at INTEGER);
    INSERT INTO applications(client_id,name) VALUES ('site','사이트');
    INSERT INTO application_settings VALUES ('site','member');
    INSERT INTO auth_operators VALUES ('operator','operator');
    INSERT INTO users VALUES ('operator','active');`);
  db.exec(readFileSync(new URL('../../migrations/0011_season_roles.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0016_membership_qualifications.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../migrations/0017_developer_qualifications.sql', import.meta.url), 'utf8'));
  for (const [token, user, client] of [['admin-token','operator','nakwol-connect-admin'], ['wrong-client','operator','site'], ['member-token','member','nakwol-connect-admin']]) {
    db.prepare('INSERT INTO access_tokens VALUES(?,?,?,?,NULL,0)').run(await sha256Base64Url(token), user, client, Date.now()+60000);
  }
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return {
      bind(...values: (string | number | null)[]) { return prepare(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args), success: true }; },
      async run() { beforeRun?.(sql, db); return db.prepare(sql).run(...args); },
    };
  }
  const env = { DB: { prepare }, NAKWOL_GUILD_ID:guild, NAKWOL_MEMBER_ROLE_ID:season, DISCORD_BOT_TOKEN:'test-bot', AUTH_ORIGIN:'https://auth.test' } as Env;
  const app = new Hono<{Bindings:Env}>();
  registerRoleAdminRoutes(app);
  function request(body: string, token='admin-token', origin='https://auth.test') {
    return app.request('https://auth.test/admin/roles', {method:'POST', headers:{ Authorization:`Bearer ${token}`, Origin:origin, 'Content-Type':'application/json' }, body}, env);
  }
  return { db, env, app, request };
}

test('qualification administration enforces scope, validates selections, isolates apps, restores legacy and audits', async () => {
  const {db,env,app}=await fixture();
  const request=(path:string,method='GET',body?:unknown,token='admin-token',origin='https://auth.test')=>app.request('https://auth.test'+path,{method,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
  const registry='/admin/api/qualifications',policy='/admin/api/apps/site/qualification-policy';
  const value={name:'시즌4 <test>',role_id:subdivision,status:'active'};
  try {
    delete env.DISCORD_BOT_TOKEN;
    assert.equal((await request(registry,'GET',undefined,'member-token')).status,403);
    assert.equal((await request(registry,'POST',value,'wrong-client')).status,401);
    assert.equal((await request(registry,'POST',value,'admin-token','https://evil.test')).status,403);
    assert.equal((await request(registry,'POST',{...value,role_id:guild})).status,400);
    assert.equal((await request(registry,'POST',{...value,status:['active']})).status,400);
    const created=await request(registry,'POST',value);assert.equal(created.status,200);
    const {id}=await created.json();
    assert.equal((await request(registry,'POST',value)).status,409);
    const list=await request(registry);assert.equal(list.headers.get('Cache-Control'),'no-store');assert.equal((await list.json()).qualifications[0].name,value.name);
    assert.equal((await request(policy)).status,200);
    for(const ids of [[],['unknown']]) assert.equal((await request(policy,'PUT',{mode:'custom',match_mode:'any',qualification_ids:ids})).status,400);
    db.exec("INSERT INTO applications(client_id,name) VALUES('other','Other'); INSERT INTO application_settings VALUES('other','member');");
    const custom={mode:'custom',match_mode:'any',qualification_ids:[id]};
    assert.equal((await request(policy,'PUT',custom)).status,200);
    assert.deepEqual((await (await request(policy)).json()).policy,custom);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM application_qualification_requirements WHERE client_id='other'").get()?.n,0);
    assert.equal((await request('/admin/api/roles','POST',{client_id:'site',role_ids:[],manual_role_ids:true})).status,409);
    assert.equal((await request(policy,'PUT',{...custom,match_mode:'all'})).status,200);
    assert.throws(()=>db.exec("UPDATE application_settings SET access_policy='admin' WHERE client_id='site'"),/CUSTOM_QUALIFICATIONS_ACTIVE/);
    db.exec("DELETE FROM application_qualification_requirements WHERE client_id='site'; UPDATE application_settings SET access_policy='admin' WHERE client_id='site'");
    assert.equal((await request(policy,'PUT',custom)).status,400);
    db.exec("UPDATE application_settings SET access_policy='member' WHERE client_id='site'");
    assert.equal((await request(registry+'/'+id,'PUT',{...value,status:'disabled'})).status,200);
    assert.equal((await request(policy,'PUT',custom)).status,400);
    assert.equal((await request(policy,'PUT',{mode:'legacy'})).status,200);
    assert.deepEqual((await (await request(policy)).json()).policy,{mode:'legacy'});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()?.n,5);
  } finally {db.close();}
});


test('qualification save returns actionable 409 when base policy changes after its read', async () => {
  let raced = false;
  const { db, env, app } = await fixture((sql, database) => {
    if (!raced && sql.startsWith('INSERT INTO application_qualification_requirements')) {
      raced = true;
      database.exec("UPDATE application_settings SET access_policy='guest' WHERE client_id='site'");
    }
  });
  try {
    db.prepare('INSERT INTO membership_qualifications(id,name,role_id,status,created_at,updated_at) VALUES(?,?,?,?,0,0)').run('season4','시즌4',subdivision,'active');
    const response = await app.request('https://auth.test/admin/api/apps/site/qualification-policy', {method:'PUT',headers:{Authorization:'Bearer admin-token',Origin:'https://auth.test','Content-Type':'application/json'},body:JSON.stringify({mode:'custom',match_mode:'any',qualification_ids:['season4']})},env);
    assert.equal(response.status,409);
    assert.equal((await response.json()).error.code,'MEMBER_POLICY_REQUIRED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM application_qualification_requirements').get()?.n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()?.n,0);
  } finally { db.close(); }
});

test('qualification publication is strict, defaults private and preserves omitted updates', async () => {
  const {db,env,app}=await fixture();
  const registry='/admin/api/qualifications';
  const request=(path:string,method='GET',body?:unknown)=>app.request('https://auth.test'+path,{method,headers:{Authorization:'Bearer admin-token',Origin:'https://auth.test','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
  const value={name:'공개할 시즌',role_id:subdivision,status:'active'};
  try {
    for(const invalid of ['true',1,null,[],{}]) assert.equal((await request(registry,'POST',{...value,developer_selectable:invalid})).status,400);
    const created=await request(registry,'POST',value);
    assert.equal(created.status,200);
    const {id}=await created.json();
    const read=async()=>((await (await request(registry)).json()).qualifications.find((q:{id:string})=>q.id===id));
    assert.equal((await read()).developer_selectable,false);
    assert.equal((await request(registry+'/'+id,'PUT',{...value,developer_selectable:true})).status,200);
    assert.equal((await read()).developer_selectable,true);
    assert.equal((await request(registry+'/'+id,'PUT',{...value,name:'이름 변경'})).status,200);
    assert.equal((await read()).developer_selectable,true);
    assert.equal((await request(registry+'/'+id,'PUT',{...value,developer_selectable:false})).status,200);
    assert.equal((await read()).developer_selectable,false);
    assert.equal((await request(registry+'/'+id,'PUT',{...value,developer_selectable:'false'})).status,400);
  } finally {db.close();}
});
