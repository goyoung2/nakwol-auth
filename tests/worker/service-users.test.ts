import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { authFixture } from '../helpers/auth-d1';
import { createSession, logAuthEvent } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { evaluateAccess } from '../../src/policy';
import { actOnServiceUser } from '../../src/service-user-actions';
import { listServiceUsers } from '../../src/service-users';

export async function serviceUsersFixture() {
  const bundle=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});
  const f=await authFixture(bundle.outputFiles[0].text), now=Date.now();
  await f.env.DB.prepare("INSERT OR IGNORE INTO applications VALUES ('nakwol-connect-admin','Admin','[]','active',0,0)").run();
  for(const id of ['owner-a','owner-b','ordinary']) {
    await f.env.DB.prepare("INSERT INTO users VALUES (?,?,NULL,'active',0,0)").bind(id,id).run();
    await createSession(f.env,id);
    await f.env.DB.prepare('INSERT INTO access_tokens VALUES (?,?,?,?,NULL,?)').bind(await sha256Base64Url(id),id,'nakwol-connect-admin',now+3600000,Date.now()).run();
  }
  for(const client of ['a','b']) {
    await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES (?,'developer','active',0,0)").bind('owner-'+client).run();
    await f.env.DB.prepare("INSERT INTO application_owners VALUES (?,?,'owner',0)").bind(client,'owner-'+client).run();
  }
  await f.env.DB.prepare("INSERT INTO auth_identities VALUES ('identity','member','discord','1550000000000000001',0,0)").run();
  await f.env.DB.prepare("INSERT INTO memberships VALUES ('member',?,1,'member','active',?,'[\"season3\"]')").bind(f.env.NAKWOL_GUILD_ID,now).run();
  const sid=await createSession(f.env,'member');
  for(const client of ['a','b']) {
    await f.env.DB.prepare('INSERT INTO access_tokens VALUES (?,?,?,?,NULL,?)').bind(await sha256Base64Url('member-'+client),'member',client,now+3600000,now).run();
    await f.env.DB.prepare('UPDATE applications SET redirect_uris=? WHERE client_id=?').bind(JSON.stringify(['https://'+client+'.test/__nakwol/callback']),client).run();
    await f.env.DB.prepare('INSERT INTO site_credentials VALUES (?,?,?,?,?,NULL)').bind('credential-'+client,await sha256Base64Url('site-'+client),client,'https://'+client+'.test',now).run();
    await f.env.DB.prepare("INSERT INTO server_sessions(id,handle_hash,user_id,client_id,site_origin,credential_id,auth_session_hash,generation,created_at,last_used_at,idle_expires_at,absolute_expires_at,idle_seconds,absolute_seconds,source,verified_at,lease_until,evidence_until,policy_version) VALUES (?,?, 'member',?,?,?,?,0,?,?,?,?,3600,86400,'role',?,?,?,0)").bind('session-'+client,await sha256Base64Url('handle-'+client),client,'https://'+client+'.test','credential-'+client,await sha256Base64Url(sid.token),now,now,now+3600000,now+86400000,now,now+300000,now+3600000).run();
  }
  const req=(path:string,actor='owner-a',body?:unknown)=>f.dispatchFetch('https://auth.test'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+actor,Origin:'https://auth.test','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {...f,req};
}
async function data(response:Response) { const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload.data; }

test('service users distinguish authorization, observation, rejection and preregistration without central enumeration',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  const list=await data(await f.req('/developer/v1/apps/a/users'));
  assert.equal(list.users.length,1);assert.equal(list.users[0].state,'authorized');assert.equal(list.users[0].lastObservedAt,null);
  assert.equal(list.users[0].discordId,'1550000000000000001');assert.notEqual(list.users[0].subject,'member');
  assert.equal((await f.req('/developer/v1/apps/b/users')).status,403);
  assert.equal((await f.req('/developer/v1/apps/a/users','ordinary')).status,403);
  const b=await data(await f.req('/developer/v1/apps/b/users','owner-b'));
  assert.notEqual(b.users[0].subject,list.users[0].subject);
  assert.equal((await f.req('/developer/v1/apps/a/users/'+b.users[0].subject)).status,404);
  const known=await data(await f.req('/developer/v1/apps/a/users','owner-a',{discordId:'1550000000000000099',reason:'manual preregistration',expectedVersion:0,idempotencyKey:'preregister-unknown'}));
  assert.equal(known.user.state,'preregistered');assert.equal(known.user.displayName,null);assert.equal(known.user.firstAuthorizedAt,null);
  await logAuthEvent(f.env,'authorize.access_denied','member','a',{diagnosis:{reason:'SEASON_ROLE_MISSING'}});
  await logAuthEvent(f.env,'discord.login.error',null,'a',{private:'must not be returned'});
  const denied=await data(await f.req('/developer/v1/apps/a/users?state=denied'));
  assert.equal(denied.users.length,1);assert.equal(denied.anonymousAttempts,1);assert.ok(!JSON.stringify(denied).includes('must not'));
  for(const field of ['role_ids','auth_session_hash','user_id','handle_hash','credential'])assert.ok(!JSON.stringify(denied.users).includes(field));
  assert.equal((await f.req('/developer/v1/apps/a/users?limit=101')).status,400);
  assert.equal((await f.req('/developer/v1/apps/a/users?cursor=bogus')).status,400);
  assert.equal((await f.req('/developer/v1/apps/a/users?supportCode=other')).status,400);
});

test('owner actions are app scoped, CAS guarded, idempotent and retain deny after relationship deletion',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  let user=(await data(await f.req('/developer/v1/apps/a/users'))).users[0];
  const act=async(action:string,key='action-'+action)=>data(await f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',{action,reason:'owner support action',expectedVersion:user.version,idempotencyKey:key}));
  const denied=await act('deny'); const repeat=await act('deny');assert.equal(repeat.operationId,denied.operationId);
  assert.equal((await evaluateAccess(f.env,'member','a')).allowed,false);assert.equal((await evaluateAccess(f.env,'member','b')).allowed,true);
  assert.equal((await f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',{action:'clear-deny',reason:'stale write',expectedVersion:user.version,idempotencyKey:'stale-write'})).status,409);
  user=await data(await f.req('/developer/v1/apps/a/users/'+user.subject)); await act('clear-deny');
  user=await data(await f.req('/developer/v1/apps/a/users/'+user.subject)); await act('revoke-app-sessions');
  assert.ok((await f.env.DB.prepare("SELECT revoked_at FROM server_sessions WHERE id='session-a'").first<{revoked_at:number}>())?.revoked_at);
  assert.equal((await f.env.DB.prepare("SELECT revoked_at FROM server_sessions WHERE id='session-b'").first<{revoked_at:null}>())?.revoked_at,null);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='member'").first<{n:number}>())?.n,1);
  assert.equal((await f.req('/developer/v1/apps/b/user-operations/'+denied.operationId,'owner-b')).status,404);
  user=await data(await f.req('/developer/v1/apps/a/users/'+user.subject));await act('deny','deny-again');
  user=await data(await f.req('/developer/v1/apps/a/users/'+user.subject));await act('delete-relationship');
  assert.equal((await f.req('/developer/v1/apps/a/users/'+user.subject)).status,404);
  assert.equal((await evaluateAccess(f.env,'member','a')).allowed,false);assert.equal((await evaluateAccess(f.env,'member','b')).allowed,true);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE client_id='a'").run();
  assert.equal((await f.req('/developer/v1/apps/a/users')).status,403);
});

test('owner grants cannot bypass season3, global deny or missing delegation and expire',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  const user=(await data(await f.req('/developer/v1/apps/a/users'))).users[0];
  const input={action:'grant',conditions:['additional-roles'],expiresAt:Date.now()+600000,reason:'temporary delegated role exception',expectedVersion:user.version,idempotencyKey:'grant-first'};
  assert.equal((await f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',input)).status,403);
  await f.env.DB.prepare("INSERT INTO auth_policy_settings VALUES ('global',1,?, 'owner-a',?)").bind(JSON.stringify({grantableConditions:['additional-roles']}),Date.now()).run();
  await f.env.DB.prepare("INSERT INTO application_role_requirements(client_id,role_ids,updated_at) VALUES ('a','[\"1550000000000000088\"]',0)").run();
  await data(await f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',input));
  assert.equal((await evaluateAccess(f.env,'member','a')).allowed,true);
  await f.env.DB.prepare("UPDATE memberships SET role_ids='[]' WHERE user_id='member'").run();assert.equal((await evaluateAccess(f.env,'member','a')).allowed,false);
  await f.env.DB.prepare("UPDATE memberships SET role_ids='[\"season3\"]' WHERE user_id='member'").run();
  await f.env.DB.prepare("INSERT INTO application_access_denies VALUES ('global','1550000000000000001','active','central deny','owner-a',?,NULL)").bind(Date.now()).run();assert.equal((await evaluateAccess(f.env,'member','a')).allowed,false);
  await f.env.DB.prepare("DELETE FROM application_access_denies WHERE scope='global'").run();
  await f.env.DB.prepare('UPDATE service_user_grants SET expires_at=?').bind(Date.now()-1).run();assert.equal((await evaluateAccess(f.env,'member','a')).allowed,false);
});

test('observations authenticate site and approved session, coalesce duplicates and never infer anonymous identity',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  const now=Date.now(); const payload={client_id:'a',site_origin:'https://a.test',events:[{sessionId:'session-a',observedAt:now}],dropped:0};
  const send=(body:unknown,credential='site-a',origin?:string)=>f.dispatchFetch('https://auth.test/server/v1/observations',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  assert.equal((await send(payload)).status,200);assert.equal((await send(payload)).status,200);
  const user=(await data(await f.req('/developer/v1/apps/a/users'))).users[0];assert.equal(user.state,'observed');assert.equal(user.observationSource,'server-gate');assert.equal(user.lastObservedAt,now);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM service_user_observations').first<{n:number}>())?.n,1);
  assert.equal((await send(payload,'site-b')).status,401);assert.equal((await send(payload,'site-a','https://a.test')).status,403);
  assert.equal((await send({...payload,events:[{sessionId:'session-b',observedAt:now}]})).status,403);
  assert.equal((await send({...payload,events:[{userId:'member',observedAt:now}]})).status,400);
  const received=user.observationReceivedAt;
  await send({...payload,events:[{sessionId:'session-a',observedAt:now-1}]});
  const reordered=(await data(await f.req('/developer/v1/apps/a/users'))).users[0];
  assert.equal(reordered.lastObservedAt,now);assert.equal(reordered.observationReceivedAt,received);
});

test('Unicode search cursors round trip and completed grants remain retryable after expiry',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  await f.env.DB.prepare("UPDATE app_user_relationships SET display_name='낙월 🌙' WHERE client_id='a'").run();
  await f.env.DB.prepare("INSERT INTO app_user_relationships(client_id,subject,discord_id,display_name,status) VALUES ('a',?,'1550000000000000099','낙월 🌙','preregistered')").bind('0'.repeat(36)).run();
  const query={q:'낙월 🌙',limit:'1'},first=await listServiceUsers(f.env,'a',query);
  assert.ok(first.nextCursor);const next=await listServiceUsers(f.env,'a',{...query,cursor:first.nextCursor});
  assert.equal(next.users.length,1);assert.notEqual(next.users[0].subject,first.users[0].subject);
  await assert.rejects(listServiceUsers(f.env,'a',{cursor:'A'.repeat(2049)}),/INVALID_CURSOR/);
  const user=(await data(await f.req('/developer/v1/apps/a/users?q=1550000000000000001'))).users[0];
  await f.env.DB.prepare("INSERT INTO auth_policy_settings VALUES ('global',1,?,'owner-a',?)").bind(JSON.stringify({grantableConditions:['additional-roles']}),Date.now()).run();
  const session=await f.env.DB.prepare("SELECT MAX(created_at) AS at FROM auth_sessions WHERE user_id='owner-a'").first<{at:number}>();assert.ok(session);
  const input={action:'grant',conditions:['additional-roles'],expiresAt:Date.now()+600000,reason:'lost response retry',expectedVersion:user.version,idempotencyKey:'retry-expired-grant'};
  const original=await actOnServiceUser(f.env,{userId:'owner-a',isOperator:false},'a',user.subject,input,session.at);
  const realNow=Date.now;Date.now=()=>input.expiresAt+1;
  try{
    const replay=await actOnServiceUser(f.env,{userId:'owner-a',isOperator:false},'a',user.subject,input,session.at);
    assert.equal(replay.operationId,original.operationId);
    await assert.rejects(actOnServiceUser(f.env,{userId:'owner-a',isOperator:false},'a',user.subject,{...input,idempotencyKey:'new-expired-grant'},session.at),/INVALID_GRANT/);
  }finally{Date.now=realNow;}
});

test('cursor pagination stays app scoped and concurrent actions apply exactly once',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  await f.env.DB.batch(Array.from({length:105},(_,i)=>f.env.DB.prepare("INSERT INTO app_user_relationships(client_id,subject,discord_id,status) VALUES ('a',?,?,'preregistered')").bind(i.toString(16).padStart(36,'0'),'155000000000001'+i.toString().padStart(4,'0'))));
  const first=await data(await f.req('/developer/v1/apps/a/users'));assert.equal(first.users.length,50);assert.ok(first.nextCursor);
  const second=await data(await f.req('/developer/v1/apps/a/users?cursor='+encodeURIComponent(first.nextCursor)));assert.equal(second.users.length,50);
  const third=await data(await f.req('/developer/v1/apps/a/users?cursor='+encodeURIComponent(second.nextCursor)));assert.equal(third.users.length,6);assert.equal(third.nextCursor,null);
  assert.equal(new Set([...first.users,...second.users,...third.users].map(u=>u.subject)).size,106);
  assert.equal((await f.req('/developer/v1/apps/b/users?cursor='+encodeURIComponent(first.nextCursor),'owner-b')).status,400);
  const search=await data(await f.req('/developer/v1/apps/a/users?q=1550000000000000001'));assert.equal(search.users.length,1);
  const user=search.users[0],body={action:'deny',reason:'parallel support action',expectedVersion:0,idempotencyKey:'parallel-operation'};
  const results=await Promise.all(Array.from({length:8},()=>f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',body)));
  assert.ok(results.every(r=>r.status===200));const rows=await Promise.all(results.map(data));assert.equal(new Set(rows.map(r=>r.operationId)).size,1);
  assert.equal((await data(await f.req('/developer/v1/apps/a/users/'+user.subject))).version,1);
  assert.equal((await f.req('/developer/v1/apps/a/users/'+user.subject+'/actions','owner-a',{...body,clientId:'b'})).status,400);
});

test('ownership revocation between API authorization and transaction prevents mutation',async t=>{
  const f=await serviceUsersFixture();t.after(f.dispose);
  const user=(await data(await f.req('/developer/v1/apps/a/users'))).users[0];
  const session=await f.env.DB.prepare("SELECT MAX(created_at) AS at FROM auth_sessions WHERE user_id='owner-a'").first<{at:number}>();assert.ok(session);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();
  await assert.rejects(actOnServiceUser(f.env,{userId:'owner-a',isOperator:true},'a',user.subject,{action:'deny',reason:'revoked owner',expectedVersion:0,idempotencyKey:'revoked-owner'},session.at),/VERSION_OR_AUTHORITY_CHANGED/);
  assert.equal((await evaluateAccess(f.env,'member','a')).allowed,true);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM service_user_operations').first<{n:number}>())?.n,0);
});
