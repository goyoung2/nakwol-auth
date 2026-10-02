import type { Env } from './types';
import { randomToken } from './crypto';
import { ServiceManagementError, type ServiceActor } from './service-management-types';
import { resolveAuthPolicy } from './auth-policy-settings';
import { serviceUser,serviceUserDto } from './service-users';
import { publishControl } from './gate-control';

const actions=['deny','clear-deny','revoke-app-sessions','grant','clear-grant','delete-relationship'] as const;
type Action=typeof actions[number];
interface Input {readonly action:Action;readonly reason:string;readonly expectedVersion:number;readonly idempotencyKey:string;readonly expiresAt:number|null;readonly conditions:readonly string[]}
function parse(body:Record<string,unknown>):Input {
  if(Object.keys(body).some(k=>!['action','reason','expectedVersion','idempotencyKey','expiresAt','conditions'].includes(k)))throw new ServiceManagementError('INVALID_BODY',400);
  const action=actions.find(a=>a===body.action);
  if(!action||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500||typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0
    ||typeof body.idempotencyKey!=='string'||!/^[\w-]{8,100}$/.test(body.idempotencyKey))throw new ServiceManagementError('INVALID_BODY',400);
  const expiresAt=body.expiresAt??null,conditions=body.conditions??[];
  if(!Array.isArray(conditions)||conditions.some(c=>c!=='additional-roles')||conditions.length>1)throw new ServiceManagementError('INVALID_CONDITIONS',400);
  if(action==='grant') {
    if(conditions.length!==1||typeof expiresAt!=='number'||!Number.isSafeInteger(expiresAt))throw new ServiceManagementError('INVALID_GRANT',400);
  }else if(conditions.length||expiresAt!==null)throw new ServiceManagementError('INVALID_BODY',400);
  return {action,reason:body.reason.trim(),expectedVersion:body.expectedVersion,idempotencyKey:body.idempotencyKey,expiresAt:typeof expiresAt==='number'?expiresAt:null,conditions};
}
const authority=`EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND
 (EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) OR EXISTS(SELECT 1 FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id WHERE o.user_id=u.id AND o.client_id=? AND d.status='active')))
 AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=? AND s.created_at=? AND s.expires_at>? AND s.created_at>=?-900000)`;
export async function serviceUserOperation(env:Env,clientId:string,operationId:string) {
  const op=await env.DB.prepare('SELECT id,action,subject,created_at FROM service_user_operations WHERE id=? AND client_id=?').bind(operationId,clientId).first<{id:string;action:string;subject:string;created_at:number}>();
  if(!op)throw new ServiceManagementError('NOT_FOUND',404);
  const receipt=await env.DB.prepare('SELECT status,published_at,observed_at FROM gate_control_outbox WHERE operation_id=? AND client_id=?').bind(operationId,clientId).first<{status:string;published_at:number|null;observed_at:number|null}>();
  const policy=await resolveAuthPolicy(env,clientId);
  return {operationId:op.id,subject:op.subject,action:op.action,createdAt:op.created_at,status:'applied',deliveryStatus:receipt?.status??'not-required',publishedAt:receipt?.published_at??null,observedAt:receipt?.observed_at??null,
    localLeaseMaxSeconds:policy.effective.leaseSeconds,boundedControlAfterPublicationMaxSeconds:35,fastRevocationSupported:false,siteProfile:'unconfirmed',allUsersObserved:false};
}
async function publish(env:Env,id:string) {
  if(env.GATE_CONTROL_SIGNING_JWK&&env.GATE_CONTROL_KID) {
    try{await publishControl(env,id);}catch(error){if(!(error instanceof Error))throw error;await env.DB.prepare("UPDATE gate_control_outbox SET status='failed' WHERE operation_id=? AND status<>'published'").bind(id).run();}
  }
}
export async function actOnServiceUser(env:Env,actor:ServiceActor,clientId:string,subject:string,body:Record<string,unknown>,authenticatedAt:number) {
  const input=parse(body),json=JSON.stringify({subject,...input});
  const previous=await env.DB.prepare('SELECT id,input_json FROM service_user_operations WHERE client_id=? AND actor=? AND idempotency_key=?').bind(clientId,actor.userId,input.idempotencyKey).first<{id:string;input_json:string}>();
  if(previous){if(previous.input_json!==json)throw new ServiceManagementError('IDEMPOTENCY_CONFLICT',409);await publish(env,previous.id);return serviceUserOperation(env,clientId,previous.id);}
  if(input.action==='grant'&&(input.expiresAt===null||input.expiresAt<Date.now()+300000||input.expiresAt>Date.now()+604800000))throw new ServiceManagementError('INVALID_GRANT',400);
  const row=await serviceUser(env,clientId,subject),policy=await resolveAuthPolicy(env,clientId);
  if(input.action==='grant'&&!policy.effective.grantableConditions.includes('additional-roles'))throw new ServiceManagementError('GRANT_NOT_DELEGATED',403);
  if(row.version!==input.expectedVersion)throw new ServiceManagementError('VERSION_CONFLICT',409);
  const id='su_'+randomToken(18),now=Date.now(),effect=`EXISTS(SELECT 1 FROM service_user_operations WHERE id=?)`;
  const guard=input.action==='grant'?`AND EXISTS(SELECT 1 FROM auth_policy_settings p,json_each(p.settings_json,'$.grantableConditions') j WHERE p.scope='global' AND j.value='additional-roles')`:'';
  const statements=[env.DB.prepare(`INSERT OR IGNORE INTO service_user_operations SELECT ?,client_id,subject,?,?,?,?,?,?,?,? FROM app_user_relationships WHERE client_id=? AND subject=? AND version=? AND ${authority} ${guard}`)
    .bind(id,actor.userId,input.action,input.reason,input.idempotencyKey,json,JSON.stringify(serviceUserDto(row)),JSON.stringify({action:input.action,version:row.version+1,expiresAt:input.expiresAt}),now,clientId,subject,input.expectedVersion,actor.userId,clientId,actor.userId,authenticatedAt,now,now)];
  switch(input.action) {
    case 'deny':statements.push(env.DB.prepare(`INSERT INTO application_access_denies SELECT ?,?,'active',?,?,?,NULL WHERE ${effect} ON CONFLICT(scope,discord_user_id) DO UPDATE SET status='active',reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at,expires_at=NULL`).bind('app:'+clientId,row.discord_id,input.reason,actor.userId,now,id));break;
    case 'clear-deny':statements.push(env.DB.prepare(`UPDATE application_access_denies SET status='revoked',updated_by=?,updated_at=?,reason=? WHERE scope=? AND discord_user_id=? AND ${effect}`).bind(actor.userId,now,input.reason,'app:'+clientId,row.discord_id,id));break;
    case 'revoke-app-sessions':
      statements.push(env.DB.prepare(`UPDATE server_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE client_id=? AND user_id=? AND ${effect}`).bind(now,clientId,row.user_id,id));
      statements.push(env.DB.prepare(`UPDATE access_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE client_id=? AND user_id=? AND ${effect}`).bind(now,clientId,row.user_id,id));
      statements.push(env.DB.prepare(`DELETE FROM auth_codes WHERE client_id=? AND user_id=? AND ${effect}`).bind(clientId,row.user_id,id));break;
    case 'grant':statements.push(env.DB.prepare(`INSERT INTO service_user_grants SELECT ?,?,?,?,?,? WHERE ${effect} ON CONFLICT(client_id,discord_id) DO UPDATE SET conditions_json=excluded.conditions_json,expires_at=excluded.expires_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(clientId,row.discord_id,JSON.stringify(input.conditions),input.expiresAt,actor.userId,now,id));break;
    case 'clear-grant':case 'delete-relationship':statements.push(env.DB.prepare(`DELETE FROM service_user_grants WHERE client_id=? AND discord_id=? AND ${effect}`).bind(clientId,row.discord_id,id));break;
  }
  statements.push(env.DB.prepare(`INSERT INTO gate_control_outbox(operation_id,client_id,created_at) SELECT ?,?,? WHERE ${effect}`).bind(id,clientId,now,id));
  if(input.action==='delete-relationship')statements.push(env.DB.prepare(`DELETE FROM app_user_relationships WHERE client_id=? AND subject=? AND ${effect}`).bind(clientId,subject,id));
  else statements.push(env.DB.prepare(`UPDATE app_user_relationships SET version=version+1 WHERE client_id=? AND subject=? AND ${effect}`).bind(clientId,subject,id));
  const results=await env.DB.batch(statements);
  if(results[0].meta.changes!==1) {
    const retry=await env.DB.prepare('SELECT id,input_json FROM service_user_operations WHERE client_id=? AND actor=? AND idempotency_key=?').bind(clientId,actor.userId,input.idempotencyKey).first<{id:string;input_json:string}>();
    if(retry?.input_json===json)return serviceUserOperation(env,clientId,retry.id);
    throw new ServiceManagementError('VERSION_OR_AUTHORITY_CHANGED',409);
  }
  await publish(env,id);return serviceUserOperation(env,clientId,id);
}
export async function preregisterServiceUser(env:Env,actor:ServiceActor,clientId:string,body:Record<string,unknown>,authenticatedAt:number) {
  if(Object.keys(body).some(k=>!['discordId','reason','expectedVersion','idempotencyKey'].includes(k))||typeof body.discordId!=='string'||!/^\d{17,20}$/.test(body.discordId)||body.expectedVersion!==0||typeof body.idempotencyKey!=='string'||!/^[\w-]{8,100}$/.test(body.idempotencyKey))throw new ServiceManagementError('INVALID_BODY',400);
  const json=JSON.stringify({discordId:body.discordId,reason:body.reason,expectedVersion:0,idempotencyKey:body.idempotencyKey});
  const existing=await env.DB.prepare('SELECT id,input_json,subject FROM service_user_operations WHERE client_id=? AND actor=? AND idempotency_key=?').bind(clientId,actor.userId,body.idempotencyKey).first<{id:string;input_json:string;subject:string}>();
  if(existing){if(existing.input_json!==json)throw new ServiceManagementError('IDEMPOTENCY_CONFLICT',409);return {operationId:existing.id,user:serviceUserDto(await serviceUser(env,clientId,existing.subject))};}
  const id='su_'+randomToken(18),subject=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now();
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO app_user_relationships(client_id,subject,discord_id,status) SELECT ?,?,?,'preregistered' WHERE ${authority}`).bind(clientId,subject,body.discordId,actor.userId,clientId,actor.userId,authenticatedAt,now,now),
    env.DB.prepare(`INSERT OR IGNORE INTO service_user_operations SELECT ?,client_id,subject,?,'preregister',?,?,?,'{}','{}',? FROM app_user_relationships WHERE client_id=? AND discord_id=? AND ${authority}`).bind(id,actor.userId,String(body.reason),body.idempotencyKey,json,now,clientId,body.discordId,actor.userId,clientId,actor.userId,authenticatedAt,now,now),
  ]);
  if(result[1].meta.changes!==1)throw new ServiceManagementError('VERSION_OR_AUTHORITY_CHANGED',409);
  const row=await env.DB.prepare('SELECT subject FROM app_user_relationships WHERE client_id=? AND discord_id=?').bind(clientId,body.discordId).first<{subject:string}>();
  if(!row)throw new ServiceManagementError('NOT_FOUND',404);
  return {operationId:id,user:serviceUserDto(await serviceUser(env,clientId,row.subject))};
}
