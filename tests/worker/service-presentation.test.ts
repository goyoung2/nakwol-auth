import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { authFixture } from '../helpers/auth-d1';
import { createSession } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { defaultPresentation } from '../../packages/connect-cli/src/shared/presentation-schema.mjs';
import {readFile} from 'node:fs/promises';
import {mutatePresentation} from '../../src/service-presentation';

async function fixture(images=false){
  const bundle=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.txt':'text'}});
  const f=await authFixture(bundle.outputFiles[0].text,undefined,images),now=Date.now();
  await f.env.DB.prepare("INSERT OR IGNORE INTO applications VALUES ('nakwol-connect-admin','Admin','[]','active',0,0)").run();
  for(const id of ['owner-a','owner-b','ordinary']){
    await f.env.DB.prepare("INSERT INTO users VALUES (?,?,NULL,'active',0,0)").bind(id,id).run();await createSession(f.env,id);
    await f.env.DB.prepare('INSERT INTO access_tokens VALUES (?,?,?,?,NULL,?)').bind(await sha256Base64Url(id),id,'nakwol-connect-admin',now+3600000,Date.now()).run();
  }
  for(const id of ['a','b']){await f.env.DB.prepare("INSERT INTO connect_developers(user_id,role,status,created_at,updated_at) VALUES (?,'developer','active',0,0)").bind('owner-'+id).run();await f.env.DB.prepare("INSERT INTO application_owners VALUES (?,?,'owner',0)").bind(id,'owner-'+id).run();}
  const req=(path:string,body?:unknown,actor='owner-a',method='POST',origin='https://auth.test')=>f.dispatchFetch('https://auth.test'+path,{method:body===undefined?'GET':method,headers:{Authorization:'Bearer '+actor,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {...f,req};
}
async function data(r:Response){const p=await r.json();assert.equal(r.status,200,JSON.stringify(p));return p.data;}
test('asset deletion between ownership precheck and draft commit cannot save a dangling reference',async t=>{
  const f=await fixture();t.after(f.dispose);const id=crypto.randomUUID();
  await f.env.DB.prepare("INSERT INTO service_brand_assets VALUES (?,?,'image/webp',?,1,1,0,'owner-a')").bind('a',id,new Uint8Array([1]).buffer).run();
  const session=await f.env.DB.prepare("SELECT MAX(created_at) at FROM auth_sessions WHERE user_id='owner-a'").first<{at:number}>();assert.ok(session);
  const config=defaultPresentation();config.screens.login.logoAssetId=id;
  const db=new Proxy(f.env.DB,{get(target,key){if(key==='batch')return async(statements:Parameters<typeof target.batch>[0])=>{await target.prepare('DELETE FROM service_brand_assets WHERE id=?').bind(id).run();return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(mutatePresentation({...f.env,DB:db},{userId:'owner-a',isOperator:false},'a','draft',{expectedVersion:0,presentation:config,reason:'asset deleted while saving'},session.at),/VERSION_OR_AUTHORITY_CHANGED/);
  const row=await f.env.DB.prepare("SELECT draft FROM service_presentations WHERE client_id='a'").first<{draft:string}>();assert.ok(!row?.draft.includes(id));
});
test('owner draft preview publish rollback CAS isolate draft and policy/session state',async t=>{
  const f=await fixture();t.after(f.dispose);const base='/developer/v1/apps/a/presentation';
  const controlBefore=(await f.env.DB.prepare('SELECT COUNT(*) n FROM gate_control_outbox').first<{n:number}>())?.n;
  assert.equal((await f.req('/developer/v1/apps/b/presentation/draft')).status,403);
  assert.equal((await f.req(base+'/draft',undefined,'ordinary')).status,403);
  let draft=await data(await f.req(base+'/draft'));assert.equal(draft.version,0);
  const config=defaultPresentation();config.screens.login.serviceName='My private draft';config.widget.visibility='hidden';
  const body={expectedVersion:0,presentation:config,reason:'edit my service'};
  assert.equal((await f.req(base+'/draft',body,'owner-a','PUT','https://evil.test')).status,403);
  draft=await data(await f.req(base+'/draft',body,'owner-a','PUT'));assert.equal(draft.version,1);
  const publicBefore=await f.dispatchFetch('https://auth.test/public/v1/apps/a/presentation');assert.ok(!(await publicBefore.text()).includes('My private draft'));
  const preview=await data(await f.req(base+'/preview',{expectedVersion:1,reason:'preview service screen'}));assert.equal(preview.presentation.screens.login.serviceName,'My private draft');
  assert.equal((await f.req(base+'/publish',{expectedVersion:0,reason:'stale publication'})).status,409);
  const published=await data(await f.req(base+'/publish',{expectedVersion:1,reason:'publish brand screen'}));assert.equal(published.version,2);
  let pub=await f.dispatchFetch('https://auth.test/public/v1/apps/a/presentation');assert.equal(pub.status,200);assert.equal(pub.headers.get('Cache-Control'),'public, max-age=60');const etag=pub.headers.get('ETag');assert.ok(etag);assert.equal((await pub.json()).version,2);
  assert.equal((await f.dispatchFetch('https://auth.test/public/v1/apps/a/presentation',{headers:{'If-None-Match':etag!}})).status,304);
  draft=await data(await f.req(base+'/draft'));draft.draft.screens.login.serviceName='Changed';
  await data(await f.req(base+'/draft',{expectedVersion:2,presentation:draft.draft,reason:'edit another brand'},'owner-a','PUT'));
  await data(await f.req(base+'/publish',{expectedVersion:3,reason:'publish next brand'}));
  const rollback=await data(await f.req(base+'/rollback',{expectedVersion:4,targetVersion:2,reason:'restore previous brand'}));assert.equal(rollback.version,5);
  pub=await f.dispatchFetch('https://auth.test/public/v1/apps/a/presentation');assert.equal((await pub.json()).screens.login.serviceName,'My private draft');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_policy_operations').first<{n:number}>())?.n,0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM gate_control_outbox').first<{n:number}>())?.n,controlBefore);
  assert.equal((await f.req(base+'/draft',{expectedVersion:5,presentation:{...config,html:'bad'},reason:'unsafe body'},'owner-a','PUT')).status,400);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();assert.equal((await f.req(base+'/draft')).status,403);
});
test('PNG JPEG WebP uploads enforce dimensions and byte quotas and reclaim only unreferenced own assets',async t=>{
  const f=await fixture(true);t.after(f.dispose);const base='/developer/v1/apps/a/presentation';
  for(const format of ['png','jpeg','webp']){const bytes=await readFile(new URL('../fixtures/presentation/logo.'+format,import.meta.url));const asset=await data(await f.req(base+'/assets',{mime:'image/'+format,base64:bytes.toString('base64'),reason:'supported image decode'}));assert.equal(asset.width,2);assert.equal(asset.height,2);assert.equal((await f.req(base+'/assets/'+asset.id,{expectedVersion:0,reason:'remove unused image'},'owner-a','DELETE')).status,200);}
  const bytes=await readFile(new URL('../fixtures/presentation/oversized.png',import.meta.url));assert.equal((await f.req(base+'/assets',{mime:'image/png',base64:bytes.toString('base64'),reason:'reject oversized dimension'})).status,400);
  assert.equal((await f.req(base+'/assets',{mime:'image/png',base64:Buffer.alloc(524289).toString('base64'),reason:'reject oversized body'})).status,413);
  const png=await readFile(new URL('../fixtures/presentation/logo.png',import.meta.url));const asset=await data(await f.req(base+'/assets',{mime:'image/png',base64:png.toString('base64'),reason:'save referenced logo'}));const config=defaultPresentation();config.screens.login.logoAssetId=asset.id;
  await data(await f.req(base+'/draft',{presentation:config,expectedVersion:0,reason:'reference logo'},'owner-a','PUT'));
  assert.equal((await f.req(base+'/assets/'+asset.id,{expectedVersion:1,reason:'cannot delete draft logo'},'owner-a','DELETE')).status,409);
  assert.equal((await f.req('/developer/v1/apps/b/presentation/assets/'+asset.id,{expectedVersion:0,reason:'another app asset'},'owner-b','DELETE')).status,409);
});
test('transaction CAS rejects concurrent publication and stale OAuth/ownership without mutating auth state',async t=>{
  const f=await fixture();t.after(f.dispose);const base='/developer/v1/apps/a/presentation';
  await data(await f.req(base+'/draft',{presentation:defaultPresentation(),expectedVersion:0,reason:'initial brand draft'},'owner-a','PUT'));
  const results=await Promise.all(Array.from({length:6},()=>f.req(base+'/publish',{expectedVersion:1,reason:'parallel publication'})));
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,5);
  const session=await f.env.DB.prepare("SELECT MAX(created_at) at FROM auth_sessions WHERE user_id='owner-a'").first<{at:number}>();assert.ok(session);
  await f.env.DB.prepare("DELETE FROM application_owners WHERE user_id='owner-a'").run();
  await assert.rejects(mutatePresentation(f.env,{userId:'owner-a',isOperator:true},'a','publish',{expectedVersion:2,reason:'revoked current authority'},session.at),/VERSION_OR_AUTHORITY_CHANGED/);
  const row=await f.env.DB.prepare("SELECT version FROM service_presentations WHERE client_id='a'").first<{version:number}>();assert.equal(row?.version,2);
  await f.env.DB.prepare("INSERT INTO application_owners VALUES ('a','owner-a','owner',0)").run();
  await f.env.DB.prepare("UPDATE auth_sessions SET created_at=? WHERE user_id='owner-a'").bind(Date.now()-16*60000).run();assert.equal((await f.req(base+'/publish',{expectedVersion:2,reason:'expired recent OAuth'})).status,403);
});
test('brand uploads perform real image decoding, enforce MIME/limits and remain owner private until published',async t=>{
  const f=await fixture(true);t.after(f.dispose);const base='/developer/v1/apps/a/presentation',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const upload={mime:'image/png',base64:png,reason:'upload branded logo'};
  assert.equal((await f.req('/developer/v1/apps/b/presentation/assets',upload)).status,403);
  assert.equal((await f.req(base+'/assets',{...upload,mime:'image/svg+xml'})).status,400);
  assert.equal((await f.req(base+'/assets',{...upload,mime:'image/jpeg'})).status,400);
  assert.equal((await f.req(base+'/assets',{...upload,base64:Buffer.from(Buffer.from(png,'base64').subarray(0,40)).toString('base64')})).status,400);
  const asset=await data(await f.req(base+'/assets',upload));assert.equal(asset.mime,'image/webp');assert.equal(asset.width,1);assert.equal(asset.height,1);
  assert.equal((await f.dispatchFetch('https://auth.test/public/v1/apps/a/brand/'+asset.id)).status,404);
  assert.equal((await f.req('/developer/v1/apps/b/presentation/assets/'+asset.id,undefined,'owner-b')).status,404);
  const privateAsset=await data(await f.req(base+'/assets/'+asset.id));assert.equal(privateAsset.mime,'image/webp');assert.ok(privateAsset.base64);
  const config=defaultPresentation();config.screens.login.logoAssetId=asset.id;
  await data(await f.req(base+'/draft',{expectedVersion:0,presentation:config,reason:'save private logo'},'owner-a','PUT'));
  assert.equal((await f.dispatchFetch('https://auth.test/public/v1/apps/a/brand/'+asset.id)).status,404);
  await data(await f.req(base+'/publish',{expectedVersion:1,reason:'publish service logo'}));
  const published=await f.dispatchFetch('https://auth.test/public/v1/apps/a/brand/'+asset.id);assert.equal(published.status,200);assert.equal(published.headers.get('Content-Type'),'image/webp');assert.equal(Buffer.from(await published.arrayBuffer()).subarray(0,4).toString(),'RIFF');
  config.screens.login.logoAssetId=asset.id;assert.equal((await f.req('/developer/v1/apps/b/presentation/draft',{expectedVersion:0,presentation:config,reason:'reuse another app logo'},'owner-b','PUT')).status,400);
});
