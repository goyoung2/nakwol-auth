import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createAuthFixture } from './auth-fixture';
import { sha256Base64Url } from '../../src/crypto';
import { registerDeveloperQualificationRoutes } from '../../src/developer-qualifications';
import type { Env } from '../../src/types';

async function fixture() {
  const f = await createAuthFixture();
  for (const id of ['other', 'operator', 'ordinary']) {
    await f.DB.prepare("INSERT INTO users VALUES(?,?,NULL,'active',0,0)").bind(id,id).run();
  }
  for (const id of ['user','other']) await f.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at,created_by_user_id) VALUES(?,'developer','active',0,0,NULL)").bind(id).run();
  await f.DB.prepare("INSERT INTO auth_operators(user_id,role,created_at) VALUES('operator','operator',0)").run();
  await f.DB.prepare("INSERT INTO applications VALUES('other-site','Other','[]','active',0,0)").run();
  await f.DB.prepare("INSERT INTO application_owners VALUES('site','user','owner',0),('other-site','other','owner',0)").run();
  await f.DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','member',0,0),('other-site','member',0,0)").run();
  await f.DB.prepare("INSERT INTO membership_qualifications VALUES('visible','Visible','1553600098661957644','active',0,0,1),('hidden','Hidden','1553600098661957645','active',0,0,0),('disabled','Disabled','1553600098661957646','disabled',0,0,1)").run();
  for (const id of ['user','other','operator','ordinary']) {
    await f.DB.prepare("INSERT INTO access_tokens(token_hash,user_id,client_id,expires_at,created_at) VALUES(?,?,'nakwol-connect-admin',?,0)").bind(await sha256Base64Url(id),id,Date.now()+60000).run();
    await f.DB.prepare("INSERT INTO connect_cli_tokens VALUES(?,?,'[\"connect:apps\"]',?,NULL,0,0)").bind(await sha256Base64Url('cli-'+id),id,Date.now()+60000).run();
  }
  const app = new Hono<{ Bindings: Env }>();
  registerDeveloperQualificationRoutes(app);
  const request = (path: string, method='GET', body?: unknown, token='user', cli=false, env=f.env, origin: string | null='https://auth.test') => {
    const headers = new Headers({Authorization:'Bearer '+(cli?'cli-':'')+token,'Content-Type':'application/json'});
    if(origin !== null) headers.set('Origin',origin);
    return app.request('https://auth.test'+(cli?'/connect/cli':'/connect/developer/api')+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)},env);
  };
  return {...f,request,app};
}

const custom = {mode:'custom',match_mode:'any',qualification_ids:['visible']};
const policy = '/apps/site/qualification-policy';

test('developer browser and CLI enforce ownership, registry visibility, active identity and audit policy edits',async t=>{
  const f=await fixture();t.after(f.dispose);
  assert.deepEqual((await (await f.request('/apps')).json()).data.map((a:{client_id:string})=>a.client_id),['site']);
  for(const cli of [false,true]) {
    const list=await f.request('/qualifications','GET',undefined,'user',cli);
    assert.equal(list.headers.get('Cache-Control'),'no-store');
    assert.deepEqual((await list.json()).qualifications.map((q:{id:string})=>q.id),['visible']);
    for(const method of ['GET','PUT']) {
      assert.equal((await f.request('/apps/other-site/qualification-policy',method,method==='PUT'?custom:undefined,'user',cli)).status,403);
      assert.equal((await f.request('/apps/missing/qualification-policy',method,method==='PUT'?custom:undefined,'user',cli)).status,403);
    }
    for(const id of ['hidden','disabled','invented','1553600098661957644']) assert.equal((await f.request(policy,'PUT',{...custom,qualification_ids:[id]},'user',cli)).status,400);
    assert.equal((await f.request(policy,'PUT',custom,'user',cli,f.env,cli?null:'https://auth.test')).status,200);
    assert.deepEqual((await (await f.request(policy,'GET',undefined,'user',cli)).json()).policy,custom);
    assert.equal((await f.request(policy,'PUT',{mode:'legacy'},'user',cli)).status,200);
    assert.equal((await f.request('/qualifications','GET',undefined,'ordinary',cli)).status,cli?401:403);
  }
  assert.equal((await f.request(policy,'GET',undefined,'other')).status,403);
  assert.equal((await f.request('/apps/other-site/qualification-policy','GET',undefined,'operator')).status,200);
  assert.equal((await f.request(policy,'PUT',custom,'user',false,f.env,null)).status,403);
  assert.equal((await f.request(policy,'PUT',custom,'user',true,f.env,'https://evil.test')).status,403);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_events').first())?.n,4);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM application_qualification_requirements WHERE client_id='other-site'").first())?.n,0);
  await f.DB.prepare("UPDATE connect_developers SET status='disabled' WHERE user_id='user'").run();
  assert.equal((await f.request('/qualifications')).status,403);
  assert.equal((await f.request('/qualifications','GET',undefined,'user',true)).status,401);
  await f.DB.prepare("UPDATE users SET status='disabled' WHERE id='operator'").run();
  assert.equal((await f.request('/qualifications','GET',undefined,'operator')).status,403);
});

test('existing unpublished selection exposes only IDs and can be replaced with published selection',async t=>{
  const f=await fixture();t.after(f.dispose);
  await f.DB.prepare("INSERT INTO application_qualification_requirements VALUES('site','all','[\"hidden\"]',0)").run();
  const current=await (await f.request(policy)).json();
  assert.deepEqual(current.locked_qualification_ids,['hidden']);
  assert.deepEqual(current.policy.qualification_ids,['hidden']);
  assert.equal(JSON.stringify(current).includes('1553600098661957645'),false);
  assert.equal((await f.request(policy,'PUT',custom)).status,200);
});

test('registry and access policy races return 409 without saving a forbidden selection',async t=>{
  const f=await fixture();t.after(f.dispose);
  for(const race of ["UPDATE membership_qualifications SET developer_selectable=0 WHERE id='visible'","UPDATE application_settings SET access_policy='guest' WHERE client_id='site'"]) {
    const env: Env={...f.env,DB:new Proxy(f.DB,{
      get(target,property,receiver) {
        if(property==='prepare') return (sql:string)=>{
          const statement=target.prepare(sql);
          if(!sql.startsWith('INSERT INTO application_qualification_requirements')) return statement;
          return new Proxy(statement,{get(s,p,r){
            if(p==='bind') return (...args:unknown[])=>{
              const bound=s.bind(...args);
              return new Proxy(bound,{get(b,k,v){
                if(k==='run')return async()=>{await target.prepare(race).run();return b.run();};
                const value=Reflect.get(b,k,v);return typeof value==='function'?value.bind(b):value;
              }});
            };
            const value=Reflect.get(s,p,r);return typeof value==='function'?value.bind(s):value;
          }});
        };
        const value=Reflect.get(target,property,receiver);return typeof value==='function'?value.bind(target):value;
      }
    })};
    const response=await f.request(policy,'PUT',custom,'user',false,env);
    assert.equal(response.status,409);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM application_qualification_requirements').first())?.n,0);
    await f.DB.prepare("UPDATE membership_qualifications SET developer_selectable=1 WHERE id='visible'").run();
  }
});


test('policy writes atomically reject owner removal and developer or user revocation',async t=>{
  const f=await fixture();t.after(f.dispose);
  const stored={mode:'custom',match_mode:'all',qualification_ids:['visible']};
  await f.DB.prepare("INSERT INTO application_qualification_requirements VALUES('site','all','[\"visible\"]',0)").run();
  for(const mode of ['custom','legacy']) {
    for(const race of [
      "DELETE FROM application_owners WHERE client_id='site' AND user_id='user'",
      "UPDATE connect_developers SET status='disabled' WHERE user_id='user'",
      "UPDATE users SET status='disabled' WHERE id='user'",
    ]) {
      const env:Env={...f.env,DB:new Proxy(f.DB,{
        get(target,property,receiver) {
          if(property==='prepare')return (sql:string)=>{
            const statement=target.prepare(sql);
            if(!/^(INSERT INTO|DELETE FROM) application_qualification_requirements/.test(sql))return statement;
            return new Proxy(statement,{get(s,p,r){
              if(p==='bind')return (...args:unknown[])=>{
                const bound=s.bind(...args);
                return new Proxy(bound,{get(b,k,v){
                  if(k==='run')return async()=>{await target.prepare(race).run();return b.run();};
                  const value=Reflect.get(b,k,v);return typeof value==='function'?value.bind(b):value;
                }});
              };
              const value=Reflect.get(s,p,r);return typeof value==='function'?value.bind(s):value;
            }});
          };
          const value=Reflect.get(target,property,receiver);return typeof value==='function'?value.bind(target):value;
        }
      })};
      const response=await f.request(policy,'PUT',mode==='legacy'?{mode}:custom,'user',false,env);
      assert.equal(response.status,403,race+' '+mode);
      await f.DB.prepare("INSERT OR IGNORE INTO application_owners VALUES('site','user','owner',0)").run();
      await f.DB.prepare("UPDATE connect_developers SET status='active' WHERE user_id='user'").run();
      await f.DB.prepare("UPDATE users SET status='active' WHERE id='user'").run();
      assert.deepEqual((await (await f.request(policy)).json()).policy,stored);
    }
  }
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM auth_events').first())?.n,0);
  assert.equal((await f.request(policy,'PUT',{mode:'legacy'})).status,200);
  assert.equal((await f.request(policy,'PUT',{mode:'legacy'})).status,200);
});
