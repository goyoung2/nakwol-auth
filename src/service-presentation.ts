import type { Hono, Context } from 'hono';
import type { Env } from './types';
import type { ServiceActor } from './service-management-types';
import { ServiceManagementError } from './service-management-types';
import { authenticateServiceActor, requireServiceOwner, requireManagementMutation, managementAuthenticatedAt } from './service-management-auth';
import { managementResponse } from './service-management-routes';
import { defaultPresentation, parsePresentation, PRESENTATION_STATES, type Presentation } from '../packages/connect-cli/src/shared/presentation-schema.mjs';

interface Row {readonly version:number;readonly draft:string;readonly published_version:number|null}
interface BrandAsset {readonly bytes:number[];readonly mime:string}
function base64(bytes:readonly number[]):string {let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(binary);}
const authority=`EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND
 (EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) OR EXISTS(SELECT 1 FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id WHERE o.user_id=u.id AND o.client_id=? AND d.status='active')))
 AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=? AND s.created_at=? AND s.expires_at>? AND s.created_at>=?-900000)`;
function validated(value:unknown):Presentation {try{return parsePresentation(value);}catch{throw new ServiceManagementError('INVALID_PRESENTATION',400);}}
function ids(document:Presentation):readonly string[] {return [...new Set(PRESENTATION_STATES.flatMap(s=>[document.screens[s].logoAssetId,document.screens[s].backgroundAssetId]).filter((id):id is string=>id!==null))];}
async function ownedAssets(env:Env,clientId:string,document:Presentation):Promise<void> {
  for(const id of ids(document))if(!await env.DB.prepare('SELECT id FROM service_brand_assets WHERE client_id=? AND id=?').bind(clientId,id).first())throw new ServiceManagementError('ASSET_NOT_OWNED',400);
}
export async function presentationDraft(env:Env,clientId:string) {
  const row=await env.DB.prepare('SELECT version,draft,published_version FROM service_presentations WHERE client_id=?').bind(clientId).first<Row>();
  const versions=await env.DB.prepare('SELECT version,created_at AS createdAt FROM service_presentation_versions WHERE client_id=? ORDER BY version DESC LIMIT 20').bind(clientId).all();
  const assets=await env.DB.prepare('SELECT id,mime,width,height FROM service_brand_assets WHERE client_id=? ORDER BY created_at DESC LIMIT 16').bind(clientId).all();
  return {version:row?.version??0,draft:row?validated(JSON.parse(row.draft)):defaultPresentation(),publishedVersion:row?.published_version??null,history:versions.results,assets:assets.results,limits:{assets:16,fileBytes:524288,dimension:2048}};
}
export async function mutatePresentation(env:Env,actor:ServiceActor,clientId:string,action:'draft'|'publish'|'rollback',body:Record<string,unknown>,authenticatedAt:number) {
  const allowed=['expectedVersion','reason',...(action==='draft'?['presentation']:action==='rollback'?['targetVersion']:[])];
  if(Object.keys(body).some(key=>!allowed.includes(key))||typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)throw new ServiceManagementError('INVALID_BODY',400);
  const current=await presentationDraft(env,clientId),now=Date.now(),nonce=crypto.randomUUID(),next=body.expectedVersion+1;
  let document=current.draft;
  if(action==='draft')document=validated(body.presentation);
  if(action==='rollback'){
    if(typeof body.targetVersion!=='number'||!Number.isSafeInteger(body.targetVersion)||body.targetVersion<1)throw new ServiceManagementError('INVALID_BODY',400);
    const target=await env.DB.prepare('SELECT document FROM service_presentation_versions WHERE client_id=? AND version=?').bind(clientId,body.targetVersion).first<{document:string}>();
    if(!target)throw new ServiceManagementError('NOT_FOUND',404);document=validated(JSON.parse(target.document));
  }
  await ownedAssets(env,clientId,document);document={...document,version:next};const serialized=JSON.stringify(document);
  const auth=[actor.userId,clientId,actor.userId,authenticatedAt,now,now];
  const referenced=ids(document);
  const assetGuard=referenced.map(()=> 'EXISTS(SELECT 1 FROM service_brand_assets WHERE client_id=? AND id=?)').join(' AND ')||'1';
  const assetBindings=referenced.flatMap(id=>[clientId,id]);
  const effect='EXISTS(SELECT 1 FROM service_presentations WHERE client_id=? AND mutation_id=?)';
  const batch=[
    env.DB.prepare(`INSERT OR IGNORE INTO service_presentations(client_id,version,draft,updated_at,updated_by,mutation_id) SELECT ?,0,?,?,?,'initial' WHERE ?=0 AND ${authority}`).bind(clientId,JSON.stringify(defaultPresentation()),now,actor.userId,body.expectedVersion,...auth),
    env.DB.prepare(`UPDATE service_presentations SET version=?,draft=?,published_version=CASE WHEN ?='draft' THEN published_version ELSE ? END,updated_at=?,updated_by=?,mutation_id=? WHERE client_id=? AND version=? AND ${authority} AND ${assetGuard}`).bind(next,serialized,action,next,now,actor.userId,nonce,clientId,body.expectedVersion,...auth,...assetBindings),
    env.DB.prepare(`INSERT INTO service_presentation_audit SELECT ?,?,?, ?,?,?,? WHERE ${effect}`).bind(nonce,clientId,next,action,actor.userId,body.reason.trim(),now,clientId,nonce),
  ];
  if(action!=='draft')batch.push(env.DB.prepare(`INSERT INTO service_presentation_versions SELECT ?,?,?,?,?,? WHERE ${effect}`).bind(clientId,next,serialized,now,actor.userId,body.reason.trim(),clientId,nonce));
  batch.push(env.DB.prepare(`DELETE FROM service_presentation_versions WHERE client_id=? AND version NOT IN (SELECT version FROM service_presentation_versions WHERE client_id=? ORDER BY version DESC LIMIT 20) AND ${effect}`).bind(clientId,clientId,clientId,nonce));
  const result=await env.DB.batch(batch);if(result[1].meta.changes!==1)throw new ServiceManagementError('VERSION_OR_AUTHORITY_CHANGED',409);
  return presentationDraft(env,clientId);
}
async function readBounded(stream:ReadableStream<Uint8Array>|null,maximum:number):Promise<Uint8Array>{
  const reader=stream?.getReader();if(!reader)throw new ServiceManagementError('INVALID_IMAGE',400);const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>maximum){await reader.cancel();throw new ServiceManagementError('IMAGE_TOO_LARGE',413);}chunks.push(item.value);}}finally{reader.releaseLock();}
  const output=new Uint8Array(length);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
export async function uploadPresentationAsset(env:Env,actor:ServiceActor,clientId:string,body:Record<string,unknown>,authenticatedAt:number){
  if(Object.keys(body).some(k=>!['mime','base64','reason'].includes(k))||typeof body.base64!=='string'||body.base64.length>699052||typeof body.mime!=='string'||!['image/png','image/jpeg','image/webp'].includes(body.mime)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)throw new ServiceManagementError('INVALID_IMAGE',400);
  if(!env.PRESENTATION_IMAGES)throw new ServiceManagementError('IMAGE_DECODER_UNAVAILABLE',409);
  let source:Uint8Array;try{if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw new Error('base64');source=Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0));}catch{throw new ServiceManagementError('INVALID_IMAGE',400);}
  if(source.length>524288)throw new ServiceManagementError('IMAGE_TOO_LARGE',413);
  let width:number,height:number,bytes:Uint8Array;
  try{
    const info=await env.PRESENTATION_IMAGES.info(new Response(source).body!);
    if(!('width' in info)||!['image/png','image/jpeg','image/webp'].includes(info.format.startsWith('image/')?info.format:'image/'+(info.format==='jpg'?'jpeg':info.format))||body.mime!==(info.format.startsWith('image/')?info.format:'image/'+(info.format==='jpg'?'jpeg':info.format)))throw new Error('MIME');
    width=info.width;height=info.height;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>2048||height>2048)throw new Error('dimensions');
    const decoded=await env.PRESENTATION_IMAGES.input(new Response(source).body!).output({format:'image/webp',quality:85,anim:false});
    bytes=await readBounded(decoded.response().body,524288);
  }catch(error){if(error instanceof ServiceManagementError)throw error;throw new ServiceManagementError('INVALID_IMAGE',400);}
  const id=crypto.randomUUID(),now=Date.now();
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO service_brand_assets SELECT ?,?,'image/webp',?,?,?,?,? WHERE (SELECT COUNT(*) FROM service_brand_assets WHERE client_id=?)<16 AND ${authority}`).bind(clientId,id,bytes.buffer,width,height,now,actor.userId,clientId,actor.userId,clientId,actor.userId,authenticatedAt,now,now),
    env.DB.prepare("INSERT INTO service_presentation_audit SELECT ?,?,0,'upload',?,?,? WHERE EXISTS(SELECT 1 FROM service_brand_assets WHERE client_id=? AND id=?)").bind(crypto.randomUUID(),clientId,actor.userId,body.reason.trim(),now,clientId,id),
  ]);if(result[0].meta.changes!==1)throw new ServiceManagementError('ASSET_LIMIT_OR_AUTHORITY_CHANGED',409);
  return {id,mime:'image/webp',width,height,bytes:bytes.length};
}
async function owner(c:Context<{Bindings:Env}>){const actor=await authenticateServiceActor(c),clientId=c.req.param('clientId')||'';await requireServiceOwner(c.env,actor,clientId);return {actor,clientId};}
const publicHeaders={'Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'};
export function registerPresentationRoutes(app:Hono<{Bindings:Env}>):void {
  const root='/developer/v1/apps/:clientId/presentation';
  app.get(root+'/draft',c=>managementResponse(c,async()=>{const {clientId}=await owner(c);return {...await presentationDraft(c.env,clientId),uploadAvailable:Boolean(c.env.PRESENTATION_IMAGES)};}));
  for(const action of ['draft','publish','rollback'] as const){const handle=(c:Context<{Bindings:Env}>)=>managementResponse(c,async()=>{const {actor,clientId}=await owner(c),body=await requireManagementMutation(c,actor,'presentation:'+clientId,16384),at=await managementAuthenticatedAt(c,actor.userId);return mutatePresentation(c.env,actor,clientId,action,body,at);});if(action==='draft')app.put(root+'/'+action,handle);else app.post(root+'/'+action,handle);}
  app.post(root+'/preview',c=>managementResponse(c,async()=>{const {clientId}=await owner(c);const current=await presentationDraft(c.env,clientId);return {presentation:current.draft,version:current.version,preview:true};}));
  app.post(root+'/assets',c=>managementResponse(c,async()=>{const {actor,clientId}=await owner(c),body=await requireManagementMutation(c,actor,'presentation-upload:'+clientId,710000),at=await managementAuthenticatedAt(c,actor.userId);return uploadPresentationAsset(c.env,actor,clientId,body,at);}));
  app.delete(root+'/assets/:assetId',c=>managementResponse(c,async()=>{
    const {actor,clientId}=await owner(c),body=await requireManagementMutation(c,actor,'presentation:'+clientId),at=await managementAuthenticatedAt(c,actor.userId),id=c.req.param('assetId'),now=Date.now();
    if(Object.keys(body).some(k=>!['expectedVersion','reason'].includes(k))||typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)throw new ServiceManagementError('INVALID_BODY',400);
    const notReferenced=`NOT EXISTS(SELECT 1 FROM service_presentations p,json_each(p.draft,'$.screens') s WHERE p.client_id=? AND (json_extract(s.value,'$.logoAssetId')=? OR json_extract(s.value,'$.backgroundAssetId')=?)) AND NOT EXISTS(SELECT 1 FROM service_presentation_versions v,json_each(v.document,'$.screens') s WHERE v.client_id=? AND (json_extract(s.value,'$.logoAssetId')=? OR json_extract(s.value,'$.backgroundAssetId')=?))`;
    const result=await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO service_presentation_audit SELECT ?,?,?, 'delete-asset',?,?,? WHERE EXISTS(SELECT 1 FROM service_brand_assets WHERE client_id=? AND id=?) AND COALESCE((SELECT version FROM service_presentations WHERE client_id=?),0)=? AND ${notReferenced} AND ${authority}`).bind(crypto.randomUUID(),clientId,body.expectedVersion,actor.userId,body.reason,now,clientId,id,clientId,body.expectedVersion,clientId,id,id,clientId,id,id,actor.userId,clientId,actor.userId,at,now,now),
      c.env.DB.prepare(`DELETE FROM service_brand_assets WHERE client_id=? AND id=? AND COALESCE((SELECT version FROM service_presentations WHERE client_id=?),0)=? AND ${notReferenced} AND ${authority}`).bind(clientId,id,clientId,body.expectedVersion,clientId,id,id,clientId,id,id,actor.userId,clientId,actor.userId,at,now,now),
    ]);if(result[1].meta.changes!==1)throw new ServiceManagementError('ASSET_REFERENCED_OR_VERSION_CHANGED',409);return {deleted:true};
  }));
  app.get(root+'/assets/:assetId',c=>managementResponse(c,async()=>{const {clientId}=await owner(c);const row=await c.env.DB.prepare('SELECT bytes,mime FROM service_brand_assets WHERE client_id=? AND id=?').bind(clientId,c.req.param('assetId')).first<BrandAsset>();if(!row)throw new ServiceManagementError('NOT_FOUND',404);return {mime:row.mime,base64:base64(row.bytes)};}));
  app.get('/public/v1/apps/:clientId/presentation',async c=>{
    const clientId=c.req.param('clientId');const row=await c.env.DB.prepare(`SELECT v.document,v.version FROM applications a LEFT JOIN service_presentations p ON p.client_id=a.client_id LEFT JOIN service_presentation_versions v ON v.client_id=p.client_id AND v.version=p.published_version WHERE a.client_id=? AND a.status='active'`).bind(clientId).first<{document:string|null;version:number|null}>();
    if(!row)return c.json({error:{code:'NOT_FOUND'}},404,{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    const etag='"presentation-'+row.version+'"';if(c.req.header('If-None-Match')===etag)return new Response(null,{status:304,headers:{...publicHeaders,ETag:etag}});
    return c.json(row.document?validated(JSON.parse(row.document)):defaultPresentation(),200,{...publicHeaders,ETag:etag});
  });
  app.get('/public/v1/apps/:clientId/brand/:assetId',async c=>{
    const clientId=c.req.param('clientId'),id=c.req.param('assetId');const version=await c.env.DB.prepare('SELECT v.document FROM service_presentations p JOIN service_presentation_versions v ON v.client_id=p.client_id AND v.version=p.published_version JOIN applications a ON a.client_id=p.client_id AND a.status=\'active\' WHERE p.client_id=?').bind(clientId).first<{document:string}>();
    if(!version||!ids(validated(JSON.parse(version.document))).includes(id))return c.body(null,404,{'Cache-Control':'no-store'});
    const row=await c.env.DB.prepare('SELECT bytes,mime FROM service_brand_assets WHERE client_id=? AND id=?').bind(clientId,id).first<BrandAsset>();
    if(!row)return c.body(null,404,{'Cache-Control':'no-store'});return new Response(new Uint8Array(row.bytes),{headers:{...publicHeaders,'Content-Type':row.mime,'Content-Security-Policy':"default-src 'none'; sandbox"}});
  });
}
export async function cleanupPresentation(env:Env):Promise<void>{await env.DB.prepare('DELETE FROM service_presentation_audit WHERE created_at<?').bind(Date.now()-180*86400000).run();}
