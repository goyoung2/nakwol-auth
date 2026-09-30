import type { Context, Hono } from 'hono';
import type { Env } from './types';
import { randomToken } from './crypto';
import { authenticateServiceActor, managementAuthenticatedAt } from './service-management-auth';
import { ServiceManagementError } from './service-management-types';
import { diagnoseApplicationAccess } from './policy';
import { resolveAuthPolicy, AUTH_POLICY_LIMITS, policyBoundaryStatements } from './auth-policy-settings';
import { ensureFreshMembership } from './membership-refresh';
import { deliverControl } from './gate-control';

export class AdminOperationError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429) { super(code); }
}
const actions = ['grant','revoke','reauthenticate','deny','clear-deny','refresh-membership','revoke-session','lock-app','unlock-app','restore-policy'] as const;
type Action = typeof actions[number];
export type AdminAction = {
  readonly action: Action; readonly reason: string; readonly discordId?: string;
  readonly scope: 'app' | 'global'; readonly expiresAt?: number;
  readonly sessionId?: string; readonly policyOperationId?: string;
};
type Operator = { readonly userId: string; readonly authenticatedAt: number };
type OperationRow = { readonly id:string;readonly actor:string;readonly client_id:string;readonly action:Action;readonly scope:string;readonly target_user_id:string|null;readonly discord_id:string|null;readonly reason:string;readonly request_json:string;readonly before_json:string;readonly after_json:string;readonly created_at:number;readonly result:string;readonly error_code:string|null };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value==='object' && !Array.isArray(value));
export async function adminBody(c: Context<{Bindings:Env}>): Promise<Record<string,unknown>> {
  if(c.req.header('Origin')!==new URL(c.env.AUTH_ORIGIN).origin) throw new AdminOperationError('INVALID_ORIGIN',403);
  const reader=c.req.raw.body?.getReader(); if(!reader) throw new AdminOperationError('INVALID_BODY',400);
  const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>8192){await reader.cancel();throw new AdminOperationError('BODY_TOO_LARGE',413);}chunks.push(item.value);}}
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try {parsed=JSON.parse(new TextDecoder().decode(bytes));}catch(error){if(error instanceof SyntaxError)throw new AdminOperationError('INVALID_BODY',400);throw error;}
  if(!record(parsed))throw new AdminOperationError('INVALID_BODY',400);
  if(typeof parsed.reason!=='string'||parsed.reason.trim().length<3||parsed.reason.length>500)throw new AdminOperationError('REASON_REQUIRED',400);
  return parsed;
}
export async function adminRate(env:Env,key:string,maximum=20):Promise<void> {
  const window=Math.floor(Date.now()/60000)*60000;
  const row=await env.DB.prepare(`INSERT INTO service_management_rate_limits VALUES(?,?,1) ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END RETURNING count`).bind('admin:'+key,window).first<{count:number}>();
  if(!row||row.count>maximum)throw new AdminOperationError('RATE_LIMITED',429);
}
export async function adminActor(c:Context<{Bindings:Env}>,fresh=false):Promise<Operator> {
  const actor=await authenticateServiceActor(c);if(!actor.isOperator)throw new AdminOperationError('FORBIDDEN',403);
  return {userId:actor.userId,authenticatedAt:await operatorAuthenticatedAt(c,actor.userId,fresh)};
}
export async function operatorAuthenticatedAt(c:Context<{Bindings:Env}>,userId:string,fresh=true):Promise<number> {
  try {return await managementAuthenticatedAt(c,userId,fresh);}
  catch(error){if(error instanceof ServiceManagementError)throw new AdminOperationError(error.code,error.status);throw error;}
}
export async function adminResponse(c:Context<{Bindings:Env}>,work:()=>Promise<unknown>):Promise<Response> {
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');
  try {return c.json(await work());}catch(error){
    if(error instanceof AdminOperationError||error instanceof ServiceManagementError)return c.json({ok:false,error:{code:error.code}},error.status);
    throw error;
  }
}
export function parseAdminAction(body:Record<string,unknown>):AdminAction {
  const action=actions.find(a=>a===body.action);if(!action)throw new AdminOperationError('INVALID_ACTION',400);
  if(Object.keys(body).some(k=>!['action','reason','discordId','scope','expiresAt','sessionId','policyOperationId','previewToken','expectedVersion','idempotencyKey'].includes(k)))throw new AdminOperationError('INVALID_BODY',400);
  if(typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)throw new AdminOperationError('REASON_REQUIRED',400);
  const scope=body.scope??'app';if(scope!=='app'&&scope!=='global')throw new AdminOperationError('INVALID_SCOPE',400);
  if(scope==='global'&&action!=='deny'&&action!=='clear-deny')throw new AdminOperationError('INVALID_SCOPE',400);
  const targetRequired=!['lock-app','unlock-app','restore-policy'].includes(action);
  if(targetRequired&&(typeof body.discordId!=='string'||!/^\d{15,22}$/.test(body.discordId)))throw new AdminOperationError('INVALID_DISCORD_ID',400);
  const expiresAt=body.expiresAt;
  if(action==='grant'||expiresAt!==undefined){if(typeof expiresAt!=='number'||!Number.isSafeInteger(expiresAt)||expiresAt<Date.now()+300000||expiresAt>Date.now()+604800000)throw new AdminOperationError('INVALID_EXPIRY',400);}
  const sessionId=body.sessionId,policyOperationId=body.policyOperationId;
  if(action==='revoke-session'&&(typeof sessionId!=='string'||!/^[\w-]{1,128}$/.test(sessionId)))throw new AdminOperationError('INVALID_SESSION',400);
  if(action==='restore-policy'&&(typeof policyOperationId!=='string'||!/^[\w-]{1,128}$/.test(policyOperationId)))throw new AdminOperationError('INVALID_POLICY_OPERATION',400);
  return {action,reason:body.reason.trim(),scope,...(typeof body.discordId==='string'?{discordId:body.discordId}:{}),...(typeof expiresAt==='number'?{expiresAt}:{}),...(typeof sessionId==='string'?{sessionId}:{}),...(typeof policyOperationId==='string'?{policyOperationId}:{})};
}
async function versionOf(env:Env):Promise<number> {return (await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS version FROM gate_control_outbox').first<{version:number}>())?.version??0;}
async function stateOf(env:Env,clientId:string,input:AdminAction) {
  const application=await env.DB.prepare('SELECT client_id,status FROM applications WHERE client_id=?').bind(clientId).first<{client_id:string;status:string}>();
  if(['lock-app','unlock-app'].includes(input.action)&&['nakwol-connect-admin','nakwol-account-center'].includes(clientId))throw new AdminOperationError('CONTROL_APP_LOCKOUT',409);
  if(!application)throw new AdminOperationError('APP_NOT_FOUND',404);
  const target=input.discordId?await env.DB.prepare("SELECT user_id FROM auth_identities WHERE provider='discord' AND provider_user_id=?").bind(input.discordId).first<{user_id:string}>():null;
  if(['reauthenticate','refresh-membership','revoke-session'].includes(input.action)&&!target)throw new AdminOperationError('USER_NOT_FOUND',404);
  const policy=await resolveAuthPolicy(env,clientId);
  if(input.action==='grant'&&!['member','guest'].includes(policy.accessPolicy??''))throw new AdminOperationError('GRANT_FORBIDDEN',403);
  const grant=input.discordId?await env.DB.prepare('SELECT status,expires_at,reason FROM application_access_grants WHERE client_id=? AND discord_user_id=?').bind(clientId,input.discordId).first():null;
  const denies=input.discordId?await env.DB.prepare("SELECT scope,status,expires_at,reason FROM application_access_denies WHERE discord_user_id=? AND scope IN ('global',?)").bind(input.discordId,'app:'+clientId).all():{results:[]};
  const sessions=target?await env.DB.prepare('SELECT id,site_origin,generation,created_at,last_used_at,idle_expires_at,absolute_expires_at,revoked_at FROM server_sessions WHERE user_id=? AND client_id=? ORDER BY created_at DESC LIMIT 100').bind(target.user_id,clientId).all():{results:[]};
  if(input.action==='revoke-session'&&!sessions.results.some(s=>s.id===input.sessionId))throw new AdminOperationError('INVALID_TARGET',404);
  if(input.action==='deny'&&target&&(input.scope==='global'||clientId==='nakwol-connect-admin')) {
    const last=await env.DB.prepare(`SELECT 1 FROM auth_operators WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id<>? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM application_access_denies d JOIN auth_identities i ON i.provider='discord' AND i.provider_user_id=d.discord_user_id AND i.user_id=o.user_id WHERE d.scope IN ('global','app:nakwol-connect-admin') AND d.status='active' AND (d.expires_at IS NULL OR d.expires_at>?)))`).bind(target.user_id,target.user_id,Date.now()).first();
    if(last)throw new AdminOperationError('LAST_OPERATOR_LOCKOUT',409);
  }
  let restore:null|{settings:Record<string,number>;accessPolicy:string|null}=null;
  if(input.action==='restore-policy') {
    const previous=await env.DB.prepare('SELECT before_json FROM auth_policy_operations WHERE id=? AND scope=?').bind(input.policyOperationId,'app:'+clientId).first<{before_json:string}>();
    if(!previous)throw new AdminOperationError('POLICY_OPERATION_NOT_FOUND',404);
    const old:unknown=JSON.parse(previous.before_json);if(!record(old)||!record(old.stored))throw new AdminOperationError('INVALID_POLICY_SNAPSHOT',409);
    if(old.accessPolicy!==policy.accessPolicy&&!(old.accessPolicy==='member'&&policy.accessPolicy==='guest'))throw new AdminOperationError('POLICY_RESTORE_WOULD_RELAX_ACCESS',409);
    const settings:Record<string,number>={};for(const [key,range] of Object.entries(AUTH_POLICY_LIMITS)) {
      const value=old.stored[key];if(value===undefined)continue;
      if(typeof value!=='number'||!Number.isInteger(value)||value<range[0]||value>range[1])throw new AdminOperationError('INVALID_POLICY_SNAPSHOT',409);
      settings[key]=value;
    }
    restore={settings,accessPolicy:typeof old.accessPolicy==='string'?old.accessPolicy:null};
  }
  return {application,policy,target,grant,denies:denies.results,sessions:sessions.results,restore};
}
export async function previewAdminAction(env:Env,actor:Operator,clientId:string,input:AdminAction) {
  const version=await versionOf(env),before=await stateOf(env,clientId,input),previewToken='op_'+randomToken(24),now=Date.now();
  if(input.action==='reauthenticate'&&before.target?.user_id===actor.userId)throw new AdminOperationError('SELF_REAUTH_FORBIDDEN',409);
  const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM server_sessions WHERE (? IS NULL OR user_id=?) AND (?='global' OR client_id=?) AND revoked_at IS NULL AND idle_expires_at>? AND absolute_expires_at>?`).bind(before.target?.user_id??null,before.target?.user_id??null,input.action==='reauthenticate'?'global':input.scope,clientId,now,now).first<{count:number}>();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_operation_previews WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO admin_operation_previews VALUES(?,?,?,?,?,?,?)').bind(previewToken,actor.userId,clientId,version,JSON.stringify(input),JSON.stringify(before),now+300000),
  ]);
  return {previewToken,version,expiresAt:now+300000,action:input.action,scope:input.scope,affectedSessions:count?.count??0,before,warning:'접수·게시·게이트 관측은 별개입니다. 구 런타임과 미확인 제어 프로필에는 빠른 차단을 보장하지 않습니다.'};
}
export async function readAdminOperation(env:Env,id:string) {
  const row=await env.DB.prepare('SELECT id,actor,client_id,action,scope,target_user_id,discord_id,reason,request_json,before_json,after_json,created_at,result,error_code FROM admin_operations WHERE id=?').bind(id).first<OperationRow>();if(!row)throw new AdminOperationError('OPERATION_NOT_FOUND',404);
  const links=await env.DB.prepare('SELECT d.client_id,d.control_seq,g.status,g.published_at,g.observed_at FROM admin_operation_deliveries d LEFT JOIN gate_control_outbox g ON g.seq=d.control_seq WHERE d.operation_id=?').bind(id).all<{client_id:string;control_seq:number;status:string|null;published_at:number|null;observed_at:number|null}>();
  const status=links.results.some(r=>r.status==='failed')?'failed':links.results.some(r=>r.status===null)?'unknown':links.results.some(r=>r.status!=='published')?'pending':links.results.length&&links.results.every(r=>r.observed_at!==null)?'observed':links.results.length?'published':'not-required';
  return {...row,before:JSON.parse(row.before_json),after:JSON.parse(row.after_json),delivery:{status,receipts:links.results,fastRevocationSupported:false,capability:'site-control-profile-unconfirmed',localLeaseMaximumSeconds:300,publicationBoundSeconds:35,allUsersObserved:false}};
}
async function resumeMembershipOperation(env:Env,id:string) {
  const owner=randomToken(24),now=Date.now();
  const row=await env.DB.prepare(`UPDATE admin_operations SET result='pending-refresh',execution_owner=?,execution_until=?,error_code=NULL WHERE id=? AND action='refresh-membership' AND result IN ('pending-refresh','unavailable') AND (execution_until IS NULL OR execution_until<=?) AND EXISTS(SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id=admin_operations.actor AND u.status='active') RETURNING target_user_id,client_id`).bind(owner,now+60000,id,now).first<{target_user_id:string;client_id:string}>();
  if(!row)return readAdminOperation(env,id);
  let refresh:Awaited<ReturnType<typeof ensureFreshMembership>>;
  try {refresh=await ensureFreshMembership(env,row.target_user_id,{force:true});}
  catch {refresh={kind:'unavailable',checkedAt:null,validUntil:0,retryAfter:null};}
  const guard='EXISTS(SELECT 1 FROM admin_operations WHERE id=? AND execution_owner=?)';
  const statements=[env.DB.prepare(`UPDATE admin_operations SET result=?,error_code=?,after_json=? WHERE id=? AND execution_owner=?`).bind(refresh.kind,refresh.kind==='unavailable'?'MEMBERSHIP_REFRESH_UNAVAILABLE':null,JSON.stringify({checkedAt:refresh.checkedAt,validUntil:refresh.validUntil,recoveryUrl:refresh.kind==='reauth-required'?env.AUTH_ORIGIN+'/account':null}),id,owner)];
  if(refresh.kind!=='unavailable') {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO gate_control_outbox(operation_id,client_id) SELECT ?||':refresh:'||client_id,client_id FROM applications WHERE (client_id=? OR client_id IN (SELECT client_id FROM server_sessions WHERE user_id=?)) AND ${guard}`).bind(id,row.client_id,row.target_user_id,id,owner),env.DB.prepare(`INSERT OR REPLACE INTO admin_operation_deliveries SELECT ?,client_id,seq FROM gate_control_outbox WHERE operation_id=?||':refresh:'||client_id AND ${guard}`).bind(id,id,id,owner));
  }
  statements.push(env.DB.prepare('UPDATE admin_operations SET execution_owner=NULL,execution_until=NULL WHERE id=? AND execution_owner=?').bind(id,owner));
  await env.DB.batch(statements);
  const links=await env.DB.prepare('SELECT client_id FROM admin_operation_deliveries WHERE operation_id=?').bind(id).all<{client_id:string}>();
  for(const link of links.results)await deliverControl(env,link.client_id);
  return readAdminOperation(env,id);
}
export async function commitAdminAction(env:Env,actor:Operator,clientId:string,input:AdminAction,confirmation:{readonly previewToken:string;readonly expectedVersion:number;readonly idempotencyKey:string;readonly recoveryHash?:string}) {
  const requestJson=JSON.stringify(input);
  const previous=await env.DB.prepare('SELECT id,request_json,client_id FROM admin_operations WHERE actor=? AND idempotency_key=?').bind(actor.userId,confirmation.idempotencyKey).first<{id:string;request_json:string;client_id:string}>();
  if(previous){if(confirmation.recoveryHash)throw new AdminOperationError('INVALID_RECOVERY',403);if(previous.request_json!==requestJson||previous.client_id!==clientId)throw new AdminOperationError('IDEMPOTENCY_CONFLICT',409);return input.action==='refresh-membership'?resumeMembershipOperation(env,previous.id):readAdminOperation(env,previous.id);}
  const preview=await env.DB.prepare('SELECT before_json FROM admin_operation_previews WHERE token=? AND actor=? AND client_id=? AND version=? AND request_json=? AND expires_at>?').bind(confirmation.previewToken,actor.userId,clientId,confirmation.expectedVersion,requestJson,Date.now()).first<{before_json:string}>();
  if(!preview)throw new AdminOperationError('PREVIEW_REQUIRED',409);
  const before=await stateOf(env,clientId,input),id='op_'+randomToken(24),now=Date.now(),target=before.target?.user_id??null,scope=input.scope==='global'?'global':'app:'+clientId;
  if(JSON.stringify(before)!==preview.before_json)throw new AdminOperationError('STATE_CONFLICT',409);
  const authority="EXISTS(SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id=? AND u.status='active')";
  const authGuard=confirmation.recoveryHash?"EXISTS(SELECT 1 FROM admin_recovery_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>? AND actor=? AND client_id=?)":"EXISTS(SELECT 1 FROM auth_sessions WHERE user_id=? AND created_at=? AND created_at>? AND expires_at>?)";
  const guard='EXISTS(SELECT 1 FROM admin_operations WHERE id=?)';
  const lastOperatorGuard=input.action==='deny'&&(input.scope==='global'||clientId==='nakwol-connect-admin')
    ? `AND (NOT EXISTS(SELECT 1 FROM auth_operators WHERE user_id=?) OR EXISTS(SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id<>? AND u.status='active' AND NOT EXISTS(SELECT 1 FROM application_access_denies d JOIN auth_identities i ON i.provider='discord' AND i.provider_user_id=d.discord_user_id AND i.user_id=o.user_id WHERE d.scope IN ('global','app:nakwol-connect-admin') AND d.status='active' AND (d.expires_at IS NULL OR d.expires_at>?))))` : '';
  const statements=[env.DB.prepare(`INSERT OR IGNORE INTO admin_operations(id,actor,client_id,action,scope,target_user_id,discord_id,reason,idempotency_key,request_json,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(seq),0) FROM gate_control_outbox)=? AND ${authority} AND ${authGuard} AND EXISTS(SELECT 1 FROM admin_operation_previews WHERE token=? AND expires_at>?) ${lastOperatorGuard}`)
    .bind(id,actor.userId,clientId,input.action,scope,target,input.discordId??null,input.reason,confirmation.idempotencyKey,requestJson,preview.before_json,JSON.stringify({action:input.action,expiresAt:input.expiresAt??null}),now,confirmation.expectedVersion,actor.userId,...(confirmation.recoveryHash?[confirmation.recoveryHash,now,actor.userId,clientId]:[actor.userId,actor.authenticatedAt,now-900000,now]),confirmation.previewToken,now,...(lastOperatorGuard?[target,target,now]:[]))];
  switch(input.action) {
    case 'grant':case 'revoke': statements.push(env.DB.prepare(`INSERT INTO application_access_grants(client_id,discord_user_id,status,reason,updated_by,updated_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(client_id,discord_user_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at,expires_at=excluded.expires_at`).bind(clientId,input.discordId,input.action==='grant'?'active':'revoked',input.reason,actor.userId,now,input.action==='grant'?input.expiresAt:null,id));break;
    case 'deny':case 'clear-deny': statements.push(env.DB.prepare(`INSERT INTO application_access_denies SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(scope,discord_user_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at,expires_at=excluded.expires_at`).bind(scope,input.discordId,input.action==='deny'?'active':'revoked',input.reason,actor.userId,now,input.expiresAt??null,id));break;
    case 'lock-app':case 'unlock-app': statements.push(env.DB.prepare(`UPDATE applications SET status=?,updated_at=? WHERE client_id=? AND ${guard}`).bind(input.action==='lock-app'?'disabled':'active',now,clientId,id));break;
    case 'revoke-session': statements.push(env.DB.prepare(`UPDATE server_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=? AND client_id=? AND ${guard}`).bind(now,input.sessionId,target,clientId,id));break;
    case 'reauthenticate':
      statements.push(env.DB.prepare(`INSERT INTO user_reauthentication(user_id,requested_at,requested_by,reason) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(user_id) DO UPDATE SET requested_at=excluded.requested_at,requested_by=excluded.requested_by,reason=excluded.reason,completed_at=NULL`).bind(target,now,actor.userId,input.reason,id),env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id=? AND ${guard}`).bind(target,id),env.DB.prepare(`DELETE FROM auth_codes WHERE user_id=? AND ${guard}`).bind(target,id),env.DB.prepare(`UPDATE access_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND ${guard}`).bind(now,target,id));break;
    case 'restore-policy': {
      if(!before.restore)throw new AdminOperationError('INVALID_POLICY_SNAPSHOT',409);
      statements.push(env.DB.prepare(`INSERT INTO auth_policy_operations(id,scope,version,actor,reason,before_json,after_json,created_at) SELECT ?,?,version+1,?,?,?,?,? FROM auth_policy_revision WHERE id=1 AND ${guard}`).bind(id,'app:'+clientId,actor.userId,input.reason,JSON.stringify(before.policy),JSON.stringify(before.restore),now,id),env.DB.prepare(`UPDATE auth_policy_revision SET version=version+1 WHERE id=1 AND ${guard}`).bind(id),env.DB.prepare(`INSERT INTO auth_policy_settings SELECT scope,version,?,actor,created_at FROM auth_policy_operations WHERE id=? ON CONFLICT(scope) DO UPDATE SET version=excluded.version,settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(JSON.stringify(before.restore.settings),id));
      if(before.restore.accessPolicy)statements.push(env.DB.prepare(`UPDATE application_settings SET access_policy=? WHERE client_id=? AND ${guard}`).bind(before.restore.accessPolicy,clientId,id));
      statements.push(...policyBoundaryStatements(env,{clientId,operationId:id}));
      break;
    }
    case 'refresh-membership': statements.push(env.DB.prepare(`UPDATE admin_operations SET result='pending-refresh' WHERE id=?`).bind(id));break;
    default: {const exhaustive:never=input.action;throw exhaustive;}
  }
  if(confirmation.recoveryHash)statements.push(env.DB.prepare(`UPDATE admin_recovery_codes SET used_at=? WHERE code_hash=? AND ${guard}`).bind(now,confirmation.recoveryHash,id));
  statements.push(env.DB.prepare(`UPDATE admin_operations SET after_json=json_object('applicationStatus',(SELECT status FROM applications WHERE client_id=?),'policySettings',json(COALESCE((SELECT settings_json FROM auth_policy_settings WHERE scope=?),'{}')),'grantStatus',(SELECT status FROM application_access_grants WHERE client_id=? AND discord_user_id=?),'denyStatus',(SELECT status FROM application_access_denies WHERE scope=? AND discord_user_id=?),'reauthenticationRequestedAt',(SELECT requested_at FROM user_reauthentication WHERE user_id=?),'revokedSiteSessions',(SELECT COUNT(*) FROM server_sessions WHERE user_id=? AND client_id=? AND revoked_at IS NOT NULL)) WHERE id=?`).bind(clientId,'app:'+clientId,clientId,input.discordId??null,scope,input.discordId??null,target,target,clientId,id));
  statements.push(env.DB.prepare(`INSERT INTO admin_operation_deliveries SELECT ?,client_id,MAX(seq) FROM gate_control_outbox WHERE seq>? AND ${guard} GROUP BY client_id`).bind(id,confirmation.expectedVersion,id),env.DB.prepare(`INSERT INTO auth_events(id,user_id,client_id,event_type,detail,created_at) SELECT ?,?,?,?, ?,? WHERE ${guard}`).bind('evt_'+randomToken(12),target,clientId,'admin.operation.'+input.action,JSON.stringify({actor_user_id:actor.userId,operation_id:id,reason:input.reason}),now,id),env.DB.prepare(`DELETE FROM admin_operation_previews WHERE token=? AND ${guard}`).bind(confirmation.previewToken,id));
  const results=await env.DB.batch(statements);
  if(results[0].meta.changes!==1) {
    const concurrent=await env.DB.prepare('SELECT id,request_json,client_id FROM admin_operations WHERE actor=? AND idempotency_key=?').bind(actor.userId,confirmation.idempotencyKey).first<{id:string;request_json:string;client_id:string}>();
    if(confirmation.recoveryHash)throw new AdminOperationError('INVALID_RECOVERY',403);
    if(concurrent&&concurrent.request_json===requestJson&&concurrent.client_id===clientId)return readAdminOperation(env,concurrent.id);
    throw new AdminOperationError('VERSION_CONFLICT',409);
  }
  if(input.action==='refresh-membership'&&target)return resumeMembershipOperation(env,id);
  if(input.scope==='global'){const targets=await env.DB.prepare('SELECT client_id FROM admin_operation_deliveries WHERE operation_id=?').bind(id).all<{client_id:string}>();for(const app of targets.results)await deliverControl(env,app.client_id);}
  else await deliverControl(env,clientId,input.action==='reauthenticate'?target??undefined:undefined);
  return readAdminOperation(env,id);
}
export function registerAdminOperationRoutes(app:Hono<{Bindings:Env}>):void {
  app.get('/admin/api/operations/:clientId/diagnosis',c=>adminResponse(c,async()=>{
    await adminActor(c);const clientId=c.req.param('clientId'),trace=c.req.query('trace_id');let discordId=c.req.query('discord_id');
    if(trace){if(!/^tr_[\w-]{16,64}$/.test(trace))throw new AdminOperationError('INVALID_TRACE',400);const row=await c.env.DB.prepare("SELECT i.provider_user_id FROM auth_events e JOIN auth_identities i ON i.user_id=e.user_id AND i.provider='discord' WHERE e.client_id=? AND json_extract(e.detail,'$.trace_id')=? AND e.created_at>? LIMIT 1").bind(clientId,trace,Date.now()-2592000000).first<{provider_user_id:string}>();if(!row)throw new AdminOperationError('TRACE_NOT_FOUND',404);discordId=row.provider_user_id;}
    if(!discordId||!/^\d{15,22}$/.test(discordId))throw new AdminOperationError('INVALID_DISCORD_ID',400);
    const current=await stateOf(c.env,clientId,{action:'clear-deny',scope:'app',discordId,reason:'operator diagnosis lookup'});
    const user=current.target?await c.env.DB.prepare('SELECT id,display_name,status FROM users WHERE id=?').bind(current.target.user_id).first():null;
    const diagnosis=current.target?await diagnoseApplicationAccess(c.env,current.target.user_id,clientId):null;
    const report=await c.env.DB.prepare('SELECT received_at,summary_json FROM gate_reports WHERE client_id=? ORDER BY id DESC LIMIT 1').bind(clientId).first<{received_at:number;summary_json:string}>();
    const latest=await c.env.DB.prepare('SELECT seq,status,published_at,observed_at FROM gate_control_outbox WHERE client_id=? ORDER BY seq DESC LIMIT 1').bind(clientId).first();
    const centralSessions=current.target?await c.env.DB.prepare('SELECT created_at,last_used_at,expires_at FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(current.target.user_id).all():{results:[]};
    const appTokens=current.target?await c.env.DB.prepare('SELECT created_at,expires_at,revoked_at FROM access_tokens WHERE user_id=? AND client_id=? ORDER BY created_at DESC LIMIT 100').bind(current.target.user_id,clientId).all():{results:[]};
    return {user,discordId,diagnosis,...current,centralSessions:centralSessions.results,appTokens:appTokens.results,report:report?{receivedAt:report.received_at,summary:JSON.parse(report.summary_json),informational:true}:null,control:latest,version:await versionOf(c.env),observedAt:Date.now(),sessionPresence:'last observation only; not online presence'};
  }));
  app.post('/admin/api/operations/:clientId/preview',c=>adminResponse(c,async()=>{const actor=await adminActor(c,true),body=await adminBody(c);await adminRate(c.env,actor.userId+':preview');return previewAdminAction(c.env,actor,c.req.param('clientId'),parseAdminAction(body));}));
  app.post('/admin/api/operations/:clientId',c=>adminResponse(c,async()=>{const actor=await adminActor(c,true),body=await adminBody(c);await adminRate(c.env,actor.userId+':commit');if(typeof body.previewToken!=='string'||typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||typeof body.idempotencyKey!=='string'||!/^[\w-]{1,128}$/.test(body.idempotencyKey))throw new AdminOperationError('INVALID_CONFIRMATION',400);return commitAdminAction(c.env,actor,c.req.param('clientId'),parseAdminAction(body),{previewToken:body.previewToken,expectedVersion:body.expectedVersion,idempotencyKey:body.idempotencyKey});}));
  app.get('/admin/api/operations/:clientId/:operationId',c=>adminResponse(c,async()=>{await adminActor(c);const result=await readAdminOperation(c.env,c.req.param('operationId'));if(result.client_id!==c.req.param('clientId'))throw new AdminOperationError('OPERATION_NOT_FOUND',404);return result;}));
  app.post('/admin/api/operations/:clientId/:operationId/retry',c=>adminResponse(c,async()=>{const actor=await adminActor(c,true);await adminBody(c);await adminRate(c.env,actor.userId+':retry');const result=await readAdminOperation(c.env,c.req.param('operationId'));if(result.client_id!==c.req.param('clientId'))throw new AdminOperationError('OPERATION_NOT_FOUND',404);const targets=await c.env.DB.prepare('SELECT client_id FROM admin_operation_deliveries WHERE operation_id=?').bind(result.id).all<{client_id:string}>();if(result.action==='refresh-membership'&&['pending-refresh','unavailable'].includes(result.result))return resumeMembershipOperation(c.env,result.id);for(const target of targets.results)await deliverControl(c.env,target.client_id);return readAdminOperation(c.env,result.id);}));
}
