import type { Hono } from 'hono';
import type { Env } from './types';
import { authenticateSiteCredential,ServerSessionError } from './site-credentials';

interface Observation {readonly sessionId:string;readonly observedAt:number}
function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
async function parseObservation(request:Request) {
  if(request.headers.has('Origin'))throw new ServerSessionError('BROWSER_REQUEST_FORBIDDEN',403);
  const reader=request.body?.getReader();if(!reader)throw new ServerSessionError('INVALID_OBSERVATION',403);
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>16384){await reader.cancel();throw new ServerSessionError('INVALID_OBSERVATION',403);}chunks.push(next.value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  let value:unknown;try{value=JSON.parse(new TextDecoder().decode(data));}catch(error){if(error instanceof SyntaxError)return null;throw error;}
  if(!record(value))return null;
  const body:Record<string,unknown>=value;
  if(Object.keys(body).some(k=>!['client_id','site_origin','events','dropped'].includes(k))||typeof body.client_id!=='string'||typeof body.site_origin!=='string'||!Array.isArray(body.events)||body.events.length>50
    ||typeof body.dropped!=='number'||!Number.isSafeInteger(body.dropped)||body.dropped<0||body.dropped>1000000)return null;
  const events:Observation[]=[];
  for(const item of body.events){if(!record(item))return null;
    const event:Record<string,unknown>=item;
    if(Object.keys(event).some(k=>!['sessionId','observedAt'].includes(k))||typeof event.sessionId!=='string'||event.sessionId.length>256||typeof event.observedAt!=='number'||!Number.isSafeInteger(event.observedAt)||event.observedAt>Date.now()||event.observedAt<Date.now()-600000)return null;
    events.push({sessionId:event.sessionId,observedAt:event.observedAt});
  }
  return {clientId:body.client_id,siteOrigin:body.site_origin,events,dropped:body.dropped};
}
export function registerServiceObservationRoutes(app:Hono<{Bindings:Env}>) {
  app.post('/server/v1/observations',async c=>{
    c.header('Cache-Control','no-store');
    try {
      const body=await parseObservation(c.req.raw);if(!body)return c.json({error:{code:'INVALID_OBSERVATION'}},400);
      const credential=await authenticateSiteCredential(c.env,c.req.header('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]??'',body.clientId,body.siteOrigin);
      const statements:D1PreparedStatement[]=[],now=Date.now();
      for(const event of body.events){
        const row=await c.env.DB.prepare(`SELECT r.subject FROM server_sessions s JOIN app_user_relationships r ON r.user_id=s.user_id AND r.client_id=s.client_id
          WHERE s.id=? AND s.client_id=? AND s.site_origin=? AND s.credential_id=? AND s.revoked_at IS NULL AND s.verified_at<=? AND s.lease_until>=?`)
          .bind(event.sessionId,body.clientId,body.siteOrigin,credential.id,event.observedAt,event.observedAt).first<{subject:string}>();
        if(!row)throw new ServerSessionError('INVALID_OBSERVATION_SESSION',403);
        const bucket=Math.floor(event.observedAt/300000)*300000;
        statements.push(c.env.DB.prepare(`INSERT INTO service_user_observations SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_user_relationships WHERE client_id=? AND subject=?)
          ON CONFLICT(client_id,subject,bucket) DO UPDATE SET received_at=CASE WHEN excluded.observed_at>observed_at THEN excluded.received_at ELSE received_at END,observed_at=MAX(observed_at,excluded.observed_at)`)
          .bind(body.clientId,row.subject,bucket,body.siteOrigin,event.observedAt,now,body.clientId,row.subject));
        statements.push(c.env.DB.prepare(`UPDATE app_user_relationships SET observation_received_at=CASE WHEN last_observed_at IS NULL OR last_observed_at<? THEN ? ELSE observation_received_at END,last_observed_at=MAX(COALESCE(last_observed_at,0),?) WHERE client_id=? AND subject=?`).bind(event.observedAt,now,event.observedAt,body.clientId,row.subject));
      }
      if(body.dropped)statements.push(c.env.DB.prepare(`INSERT INTO service_observation_drops VALUES(?,?,?,?) ON CONFLICT(client_id,site_origin,bucket) DO UPDATE SET dropped=dropped+excluded.dropped`).bind(body.clientId,body.siteOrigin,Math.floor(now/300000)*300000,body.dropped));
      if(statements.length)await c.env.DB.batch(statements);
      return c.json({ok:true});
    }catch(error){if(error instanceof ServerSessionError)return c.json({error:{code:error.code}},error.status);return c.json({error:{code:'OBSERVATIONS_UNAVAILABLE'}},503);}
  });
}
