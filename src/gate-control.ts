import type { Hono } from 'hono';
import type { Env } from './types';
import type { ControlProjection } from './gate-control-object';
import { authenticateSiteCredential,ServerSessionError } from './site-credentials';

const encoder=new TextEncoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function controlVersion(env:Env,clientId:string):Promise<number> {
  return (await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS version FROM gate_control_outbox WHERE client_id=?').bind(clientId).first<{version:number}>())?.version??0;
}
function coordinator(env:Env,clientId:string) {
  if(!env.GATE_CONTROL)throw new ServerSessionError('CONTROL_UNAVAILABLE',503);
  return env.GATE_CONTROL.get(env.GATE_CONTROL.idFromName(clientId));
}
/** Idempotent publication, with a transactional D1 projection and monotonic DO CAS. */
export async function publishControl(env:Env,operationId:string):Promise<void> {
  const operation=await env.DB.prepare('SELECT client_id FROM gate_control_outbox WHERE operation_id=?').bind(operationId).first<{client_id:string}>();
  if(!operation)throw new ServerSessionError('CONTROL_OPERATION_UNKNOWN',503);
  const clientId=operation.client_id;
  const batch=await env.DB.batch([
    env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS version FROM gate_control_outbox WHERE client_id=?').bind(clientId),
    env.DB.prepare('SELECT status FROM applications WHERE client_id=?').bind(clientId),
    env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM auth_policy_settings WHERE scope IN ('global',?)").bind('app:'+clientId),
    env.DB.prepare('SELECT id FROM server_sessions WHERE client_id=? AND revoked_at IS NOT NULL AND absolute_expires_at>? LIMIT 301').bind(clientId,Date.now()),
  ]);
  const value=(index:number,key:string)=>Reflect.get(batch[index].results[0]??{},key);
  const version=Number(value(0,'version'));
  const revocations=batch[3].results.map(row=>String(row && typeof row==='object' ? Reflect.get(row,'id') : ''));
  const projection:ControlProjection={clientId,version,appEpoch:version,appStatus:String(value(1,'status')??'disabled'),policyFloor:Number(value(2,'version')??0),revocations:revocations.length>300?[]:revocations};
  const result=await coordinator(env,clientId).fetch('https://control.internal/publish',{method:'POST',body:JSON.stringify(projection)});
  if(result.status!==200)throw new ServerSessionError('CONTROL_PUBLICATION_FAILED',503);
  await env.DB.batch([
    env.DB.prepare("UPDATE gate_control_outbox SET status='published',published_at=COALESCE(published_at,?) WHERE client_id=? AND seq<=?").bind(Date.now(),clientId,version),
    env.DB.prepare("UPDATE auth_policy_operations SET delivery_status='published' WHERE delivery_status<>'published' AND EXISTS(SELECT 1 FROM gate_control_outbox g WHERE g.policy_operation_id=auth_policy_operations.id) AND NOT EXISTS(SELECT 1 FROM gate_control_outbox g WHERE g.policy_operation_id=auth_policy_operations.id AND g.status<>'published')"),
  ]);
}
async function failedControl(env:Env,operationId:string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE gate_control_outbox SET status='failed' WHERE client_id=(SELECT client_id FROM gate_control_outbox WHERE operation_id=?) AND status<>'published'").bind(operationId),
    env.DB.prepare("UPDATE auth_policy_operations SET delivery_status='failed' WHERE EXISTS(SELECT 1 FROM gate_control_outbox g WHERE g.policy_operation_id=auth_policy_operations.id AND g.status='failed')"),
  ]);
}
export async function publishPendingControl(env:Env) {
  const pending=await env.DB.prepare("SELECT operation_id FROM gate_control_outbox WHERE seq IN (SELECT MAX(seq) FROM gate_control_outbox WHERE status<>'published' GROUP BY client_id) LIMIT 100").all<{operation_id:string}>();
  let published=0,failed=0;
  for(const row of pending.results) {
    try {await publishControl(env,row.operation_id);published++;}
    catch(error) {
      if(!(error instanceof Error))throw error;
      await failedControl(env,row.operation_id);failed++;
    }
  }
  await env.DB.prepare("DELETE FROM gate_control_outbox WHERE status='published' AND created_at<? AND seq<(SELECT MAX(g.seq) FROM gate_control_outbox g WHERE g.client_id=gate_control_outbox.client_id)").bind(Date.now()-30*86400000).run();
  return {published,failed};
}
export async function deliverControl(env:Env,clientId:string,userId?:string) {
  const targets=userId
    ? await env.DB.prepare('SELECT DISTINCT client_id FROM server_sessions WHERE user_id=?').bind(userId).all<{client_id:string}>()
    : {results:[{client_id:clientId}]};
  const receipts=[];
  for(const target of targets.results) {
    const operation=await env.DB.prepare('SELECT operation_id,seq FROM gate_control_outbox WHERE client_id=? ORDER BY seq DESC LIMIT 1').bind(target.client_id).first<{operation_id:string;seq:number}>();
    if(!operation)continue;
    if(env.GATE_CONTROL_SIGNING_JWK&&env.GATE_CONTROL_KID) {
      try{await publishControl(env,operation.operation_id);}
      catch(error){
        if(!(error instanceof Error))throw error;
        await failedControl(env,operation.operation_id);
      }
    }
    const receipt=await env.DB.prepare('SELECT operation_id AS operationId,seq AS version,status AS deliveryStatus,published_at AS publishedAt,observed_at AS observedAt FROM gate_control_outbox WHERE operation_id=?').bind(operation.operation_id).first();
    receipts.push({clientId:target.client_id,...receipt});
  }
  return {receipts,legacyRuntimeSupported:false};
}
export async function readControl(env:Env,clientId:string,siteOrigin:string) {
  const started=Date.now();
  // An indexed per-app outbox lookup is required before signing. Never sign stale
  // coordinator state while an unpublished DB mutation is pending.
  const pending=await env.DB.prepare("SELECT operation_id FROM gate_control_outbox WHERE client_id=? AND status<>'published' ORDER BY seq DESC LIMIT 1").bind(clientId).first<{operation_id:string}>();
  if(pending)await publishControl(env,pending.operation_id);
  const response=await coordinator(env,clientId).fetch('https://control.internal/read');
  if(response.status!==200)throw new ServerSessionError('CONTROL_UNAVAILABLE',503);
  const projection=await response.json<ControlProjection>();
  // Fence a mutation that committed while publication/read was in flight.
  if(await controlVersion(env,clientId)!==projection.version)throw new ServerSessionError('CONTROL_CHANGED',503);
  if(!env.GATE_CONTROL_SIGNING_JWK || !env.GATE_CONTROL_KID || !/^[\w-]{1,64}$/.test(env.GATE_CONTROL_KID))throw new ServerSessionError('CONTROL_KEY_UNAVAILABLE',503);
  const jwk:JsonWebKey=JSON.parse(env.GATE_CONTROL_SIGNING_JWK);
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const issuedAt=started;
  const document={schemaVersion:1,audience:'nakwol-control-v1',...projection,siteOrigin,issuedAt,expiresAt:issuedAt+30000};
  const payload=b64(encoder.encode(JSON.stringify(document)));
  const signed=encoder.encode(env.GATE_CONTROL_KID+'.'+payload);
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,signed);
  return {kid:env.GATE_CONTROL_KID,payload,signature:b64(new Uint8Array(signature))};
}
export function registerGateControlRoutes(app:Hono<{Bindings:Env}>) {
  app.post('/server/v1/control',async c=>{
    c.header('Cache-Control','no-store');
    try {
      if(c.req.header('Origin')!==undefined)throw new ServerSessionError('BROWSER_REQUEST_FORBIDDEN',403);
      const reader=c.req.raw.body?.getReader();if(!reader)throw new ServerSessionError('INVALID_BODY',403);
      let size=0;const chunks:Uint8Array[]=[];
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new ServerSessionError('BODY_TOO_LARGE',403);}chunks.push(value);}}
      finally{reader.releaseLock();}
      const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
      const body:unknown=JSON.parse(new TextDecoder().decode(raw));
      if(!body||typeof body!=='object')throw new ServerSessionError('INVALID_BODY',403);
      const clientId:unknown=Reflect.get(body,'client_id'),siteOrigin:unknown=Reflect.get(body,'site_origin');
      if(typeof clientId!=='string'||typeof siteOrigin!=='string'||clientId.length>256||siteOrigin.length>2048)throw new ServerSessionError('INVALID_BODY',403);
      await authenticateSiteCredential(c.env,c.req.header('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]??'',clientId,siteOrigin);
      const result=await readControl(c.env,clientId,siteOrigin);
      const observed:unknown=Reflect.get(body,'observed_version');
      if(typeof observed==='number'&&Number.isSafeInteger(observed)&&observed>=0)await c.env.DB.prepare('UPDATE gate_control_outbox SET observed_at=? WHERE client_id=? AND seq<=? AND status=\'published\' AND observed_at IS NULL').bind(Date.now(),clientId,observed).run();
      return c.json(result);
    }catch(error){
      if(error instanceof ServerSessionError)return c.json({ok:false,error:{code:error.code}},error.status);
      return c.json({ok:false,error:{code:'CONTROL_UNAVAILABLE'}},503);
    }
  });
}
