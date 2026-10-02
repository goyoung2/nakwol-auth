import type { Context,Hono } from 'hono';
import type { Env } from './types';
import { exchangeServerCode,refreshServerSession,revokeServerSession } from './server-sessions';
import { issueSiteCredential,revokeSiteCredential,ServerSessionError } from './site-credentials';
import { authenticateServiceActor,requireServiceOwner,requireManagementMutation } from './service-management-auth';
import { managementResponse } from './service-management-routes';
import { ServiceManagementError } from './service-management-types';

async function bodyOf(c:Context<{Bindings:Env}>) {
  if (c.req.header('Origin') !== undefined) throw new ServerSessionError('BROWSER_REQUEST_FORBIDDEN',403);
  const reader=c.req.raw.body?.getReader();
  if (!reader) throw new ServerSessionError('INVALID_BODY',403);
  const chunks:Uint8Array[]=[];let size=0;
  try { for (;;) { const item=await reader.read();if(item.done)break;size+=item.value.byteLength;
    if(size>8192){await reader.cancel();throw new ServerSessionError('BODY_TOO_LARGE',403);}chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try { parsed=JSON.parse(new TextDecoder().decode(data)); }catch {throw new ServerSessionError('INVALID_BODY',403);}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ServerSessionError('INVALID_BODY',403);
  return parsed;
}
function field(body:object,key:string):string {
  const value=Reflect.get(body,key);
  if(typeof value!=='string'||!value||value.length>2048)throw new ServerSessionError('INVALID_BODY',403);
  return value;
}
export function registerServerSessionRoutes(app:Hono<{Bindings:Env}>):void {
  for(const operation of ['code-exchange','session/refresh','session/revoke'] as const) {
    app.post('/server/v1/'+operation,async c=>{
      c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');
      try {
        const body=await bodyOf(c),credential=c.req.header('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]??'';
        const binding={clientId:field(body,'client_id'),siteOrigin:field(body,'site_origin'),credential};
        switch(operation) {
          case 'code-exchange': return c.json(await exchangeServerCode(c.env,{...binding,code:field(body,'code'),redirectUri:field(body,'redirect_uri'),codeVerifier:field(body,'code_verifier')}));
          case 'session/refresh': {
            const expectedGeneration:unknown=Reflect.get(body,'expected_generation');
            if(typeof expectedGeneration!=='number'||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw new ServerSessionError('INVALID_GENERATION',409);
            return c.json(await refreshServerSession(c.env,{...binding,sessionId:field(body,'session_id'),handle:field(body,'handle'),expectedGeneration}));
          }
          case 'session/revoke':return c.json(await revokeServerSession(c.env,{...binding,sessionId:field(body,'session_id'),handle:field(body,'handle')}));
        }
      }catch(error){
        if(error instanceof ServerSessionError)return c.json({ok:false,error:{code:error.code}},error.status);
        return c.json({ok:false,error:{code:'AUTH_UNAVAILABLE'}},503);
      }
    });
  }
  app.post('/developer/v1/apps/:clientId/site-credentials',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId');
    await requireServiceOwner(c.env,actor,clientId);
    const body=await requireManagementMutation(c,actor,'credential:'+clientId);
    if(Object.keys(body).some(key=>!['siteOrigin','reason'].includes(key))||typeof body.siteOrigin!=='string')throw new ServiceManagementError('INVALID_BODY',400);
    return issueSiteCredential(c.env,actor.userId,clientId,body.siteOrigin,String(body.reason));
  }));
  app.post('/developer/v1/apps/:clientId/site-credentials/:credentialId/revoke',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId');
    await requireServiceOwner(c.env,actor,clientId);
    const body=await requireManagementMutation(c,actor,'credential:'+clientId);
    if(Object.keys(body).some(key=>key!=='reason'))throw new ServiceManagementError('INVALID_BODY',400);
    return revokeSiteCredential(c.env,actor.userId,clientId,c.req.param('credentialId'),String(body.reason));
  }));
}
