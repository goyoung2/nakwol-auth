import type {Hono} from 'hono';
import type {Env} from './types';
import type {ServiceActor} from './service-management-types';
import {ServiceManagementError} from './service-management-types';
import {authenticateServiceActor, requireServiceOwner, requireManagementMutation} from './service-management-auth';
import {managementResponse} from './service-management-routes';
import {resolveAuthPolicy} from './auth-policy-settings';
import {requirePrincipal} from './connect-cli-apps';
import {issueSiteCredential} from './site-credentials';
import {parseSetup, SetupError, type SetupDocument} from '../packages/connect-cli/src/shared/setup-schema.mjs';

interface SetupRow {id:string; actor_id:string; client_id:string; version:number; document_json:string; request_json:string}
const ownerSql=`EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND
 (EXISTS(SELECT 1 FROM auth_operators WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM application_owners o
 JOIN connect_developers d ON d.user_id=o.user_id WHERE o.user_id=u.id AND o.client_id=? AND d.status='active')))`;
const freshSql=`EXISTS(SELECT 1 FROM auth_sessions WHERE user_id=? AND created_at>=? AND expires_at>?)`;
const versionsSql=`COALESCE((SELECT MAX(version) FROM auth_policy_settings WHERE scope IN ('global',?)),0)=?
 AND COALESCE((SELECT published_version FROM service_presentations WHERE client_id=?),0)=?`;
function document(value:unknown):SetupDocument {
  try {return parseSetup(value);} catch(error) {if(error instanceof SetupError)throw new ServiceManagementError(error.code,400);throw error;}
}
function version(value:unknown):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ServiceManagementError('SETUP_INVALID_VERSION',400);
  return value;
}
function fields(body:Record<string,unknown>,allowed:readonly string[]):void {
  if(Object.keys(body).some(key=>!allowed.includes(key)))throw new ServiceManagementError('SETUP_UNKNOWN_FIELDS',400);
}
async function readSetup(env:Env, actor:ServiceActor, clientId:string, id:string):Promise<SetupRow> {
  await requireServiceOwner(env,actor,clientId);
  const row=await env.DB.prepare('SELECT * FROM service_setups WHERE id=? AND client_id=? AND actor_id=?').bind(id,clientId,actor.userId).first<SetupRow>();
  if(!row)throw new ServiceManagementError('NOT_FOUND',404);
  return row;
}
async function setupResult(env:Env,row:SetupRow) {
  const setup=document(JSON.parse(row.document_json));
  const policy=await resolveAuthPolicy(env,row.client_id);
  const presentation=await env.DB.prepare('SELECT published_version FROM service_presentations WHERE client_id=?').bind(row.client_id).first<{published_version:number|null}>();
  const app=await env.DB.prepare(`SELECT a.client_id,a.redirect_uris,a.status,COALESCE(s.access_policy,'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id=a.client_id WHERE a.client_id=?`).bind(row.client_id).first<{client_id:string;redirect_uris:string;status:string;access_policy:string}>();
  if(!app)throw new ServiceManagementError('NOT_FOUND',404);
  return {setup,version:row.version,stale:setup.policyVersion!==policy.policyVersion||setup.presentationVersion!==(presentation?.published_version??0),
    central:'saved',localInstallation:'unverified',deployment:'unverified',acceptance:'unverified',
    app:{...app,redirect_uris:JSON.parse(app.redirect_uris)},policyVersion:policy.policyVersion,presentationVersion:presentation?.published_version??0};
}
export function registerDeveloperSetupRoutes(app:Hono<{Bindings:Env}>):void {
  app.get('/developer/v1/apps/:clientId/setup',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId');await requireServiceOwner(c.env,actor,clientId);
    const rows=await c.env.DB.prepare('SELECT id,version,updated_at FROM service_setups WHERE actor_id=? AND client_id=? ORDER BY updated_at DESC LIMIT 20').bind(actor.userId,clientId).all();
    return {setups:rows.results};
  }));
  app.get('/developer/v1/apps/:clientId/setup/:id',c=>managementResponse(c,async()=>setupResult(c.env,await readSetup(c.env,await authenticateServiceActor(c),c.req.param('clientId'),c.req.param('id')))));
  app.get('/connect/cli/apps/:clientId/setup/:id',async c=>{
    const principal=await requirePrincipal(c);if(principal instanceof Response)return principal;
    return managementResponse(c,async()=>setupResult(c.env,await readSetup(c.env,{userId:principal.userId,isOperator:principal.isOperator},c.req.param('clientId'),c.req.param('id'))));
  });
  app.post('/developer/v1/apps/:clientId/setup',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId');await requireServiceOwner(c.env,actor,clientId);
    const body=await requireManagementMutation(c,actor,'setup:'+clientId);fields(body,['setup','expectedVersion','reason']);
    const setup=document(body.setup),expected=version(body.expectedVersion);
    if(setup.clientId!==clientId)throw new ServiceManagementError('SETUP_CLIENT_MISMATCH',400);
    const request=JSON.stringify({setup,expectedVersion:expected,reason:body.reason});
    const existing=await c.env.DB.prepare('SELECT * FROM service_setups WHERE id=?').bind(setup.idempotencyKey).first<SetupRow>();
    if(existing&&(existing.actor_id!==actor.userId||existing.client_id!==clientId))throw new ServiceManagementError('NOT_FOUND',404);
    if(existing?.request_json===request)return setupResult(c.env,existing);
    if(existing&&document(JSON.parse(existing.document_json)).siteOrigin!==setup.siteOrigin&&await c.env.DB.prepare('SELECT 1 FROM service_setup_credentials WHERE setup_id=?').bind(setup.idempotencyKey).first())throw new ServiceManagementError('SETUP_CREDENTIAL_ORIGIN_CONFLICT',409);
    const now=Date.now(),guard=`${ownerSql} AND ${freshSql} AND ${versionsSql}`;
    const params=[actor.userId,clientId,actor.userId,now-900000,now,'app:'+clientId,setup.policyVersion,clientId,setup.presentationVersion];
    const serialized=JSON.stringify(setup);
    const write=existing
      ?c.env.DB.prepare(`UPDATE service_setups SET version=version+1,document_json=?,request_json=?,updated_at=? WHERE id=? AND actor_id=? AND client_id=? AND version=?
        AND (json_extract(document_json,'$.siteOrigin')=? OR NOT EXISTS(SELECT 1 FROM service_setup_credentials WHERE setup_id=service_setups.id)) AND ${guard}`).bind(serialized,request,now,setup.idempotencyKey,actor.userId,clientId,expected,setup.siteOrigin,...params)
      :c.env.DB.prepare(`INSERT OR IGNORE INTO service_setups SELECT ?,?,?,1,?,?,? WHERE ?=0 AND ${guard}`).bind(setup.idempotencyKey,actor.userId,clientId,serialized,request,now,expected,...params);
    // Registration and the checkpoint share a transaction, preserving other registered sites.
    const result=await c.env.DB.batch([write,c.env.DB.prepare(`UPDATE applications SET redirect_uris=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(applications.redirect_uris) UNION SELECT ? UNION SELECT ?)),updated_at=?
      WHERE client_id=? AND changes()=1 AND EXISTS(SELECT 1 FROM service_setups WHERE id=? AND actor_id=? AND request_json=?)`)
      .bind(setup.siteOrigin+'/',setup.siteOrigin+'/__nakwol/callback',now,clientId,setup.idempotencyKey,actor.userId,request)]);
    if(result[0].meta.changes!==1) {
      const replay=await readSetup(c.env,actor,clientId,setup.idempotencyKey).catch(()=>null);
      if(replay?.request_json===request)return setupResult(c.env,replay);
      throw new ServiceManagementError('SETUP_CONFLICT_OR_STALE',409);
    }
    return setupResult(c.env,await readSetup(c.env,actor,clientId,setup.idempotencyKey));
  }));
  app.post('/developer/v1/apps/:clientId/setup/:id/credential',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId');
    const row=await readSetup(c.env,actor,clientId,c.req.param('id'));
    const body=await requireManagementMutation(c,actor,'setup-credential:'+clientId);fields(body,['expectedVersion','reason']);
    if(version(body.expectedVersion)!==row.version)throw new ServiceManagementError('SETUP_CONFLICT_OR_STALE',409);
    const current=await setupResult(c.env,row);if(current.stale)throw new ServiceManagementError('SETUP_CONFLICT_OR_STALE',409);
    return issueSiteCredential(c.env,actor.userId,clientId,current.setup.siteOrigin,String(body.reason),{id:row.id,version:row.version});
  }));
  app.post('/developer/v1/setup/apps',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),body=await requireManagementMutation(c,actor,'setup-create');
    fields(body,['clientId','name','siteOrigin','idempotencyKey','reason']);
    const setup=document({schemaVersion:1,clientId:body.clientId,siteOrigin:body.siteOrigin,provider:'cloudflare-workers',buildDirectory:'dist',presentationVersion:0,policyVersion:0,step:'service',idempotencyKey:body.idempotencyKey});
    if(typeof body.name!=='string'||body.name.trim().length<1||body.name.length>100||/[\x00-\x1f]/.test(body.name))throw new ServiceManagementError('INVALID_NAME',400);
    const request=JSON.stringify({clientId:setup.clientId,name:body.name.trim(),siteOrigin:setup.siteOrigin,reason:body.reason}),now=Date.now(),mutation=crypto.randomUUID();
    const active=`EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND (EXISTS(SELECT 1 FROM auth_operators WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM connect_developers WHERE user_id=u.id AND status='active')))`;
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO service_setup_creations SELECT ?,?,?,?,?,? WHERE ${active} AND ${freshSql} AND NOT EXISTS(SELECT 1 FROM applications WHERE client_id=?)`).bind(actor.userId,setup.idempotencyKey,setup.clientId,request,mutation,now,actor.userId,actor.userId,now-900000,now,setup.clientId),
      c.env.DB.prepare(`INSERT INTO applications SELECT client_id,?,?,'active',?,? FROM service_setup_creations WHERE mutation_id=?`).bind(body.name.trim(),JSON.stringify([setup.siteOrigin+'/',setup.siteOrigin+'/__nakwol/callback']),now,now,mutation),
      c.env.DB.prepare(`INSERT INTO application_settings(client_id,homepage_url,framework,access_policy,created_at,updated_at) SELECT client_id,?,'other','member',?,? FROM service_setup_creations WHERE mutation_id=?`).bind(setup.siteOrigin+'/',now,now,mutation),
      c.env.DB.prepare(`INSERT INTO application_owners SELECT client_id,actor_id,'owner',? FROM service_setup_creations WHERE mutation_id=?`).bind(now,mutation),
    ]);
    const receipt=await c.env.DB.prepare('SELECT client_id,request_json FROM service_setup_creations WHERE actor_id=? AND idempotency_key=?').bind(actor.userId,setup.idempotencyKey).first<{client_id:string;request_json:string}>();
    if(!receipt||receipt.request_json!==request)throw new ServiceManagementError('SETUP_CREATE_CONFLICT',409);
    await requireServiceOwner(c.env,actor,receipt.client_id);return {clientId:receipt.client_id};
  }));
}
