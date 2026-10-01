import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createNativeHostingAdapter} from '../src/hosting-native.mjs';
const document=provider=>({schemaVersion:1,clientId:'site',siteOrigin:'https://site.test',provider,accountId:provider==='vercel'?'':'a'.repeat(32),resourceId:provider==='vercel'?'prj_site':'site',teamId:provider==='vercel'?'team_site':'',mode:'automatic',controlledDeployments:true,origins:['https://site.test'],adapterFile:'ops/adapter.mjs'});
async function fixture(t,provider){
 const root=await mkdtemp(join(tmpdir(),'nakwol-native-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.nakwol/reports/hosting'),{recursive:true});await writeFile(join(root,'.nakwol/reports/hosting/operation.lock'),JSON.stringify({pid:process.pid,operationId:'lease-owner'}));
 let active='old',version='old-version',writes=0,uploadCount=0,foreign=false,conflict=false,operationId=null;const seen=[];
 const fetchImpl=async(url,options)=>{const target=new URL(url);seen.push({path:target.pathname,method:options.method,body:options.body?JSON.parse(options.body):null});let result;
  if(provider==='cloudflare-workers'){
   if(target.pathname.endsWith('/subdomain'))result={enabled:false,previews_enabled:false};
   else if(target.pathname.endsWith('/domains'))result=[];
   else if(target.pathname.endsWith('/versions/new-version'))result={id:'new-version',metadata:{annotations:{'workers/message':'nakwol:'+operationId+':'+'a'.repeat(64)+':0.14.0'}}};
   else if(target.pathname.endsWith('/deployments/old'))result={id:'old',created_on:'2026-01-01T00:00:00Z',versions:[{version_id:'old-version',percentage:100}]};
   else if(options.method==='POST'){writes++;active=version==='old-version'?'new':'recovered';version=JSON.parse(options.body).versions[0].version_id;result={id:active};}
   else result={deployments:[{id:active,created_on:'2026-02-01T00:00:00Z',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':operationId?'nakwol:'+operationId:''}}]};
   return new Response(JSON.stringify({success:true,result}));
  }
  if(target.pathname.includes('/v6/deployments'))result={deployments:[{projectId:'prj_site',url:'old.vercel.app'},...(uploadCount?[{projectId:'prj_site',url:'new.vercel.app'}]:[])],pagination:{next:null}};
  else if(target.pathname.endsWith('/domains'))result={domains:[],pagination:{next:null}};
  else if(target.pathname==='/v4/aliases')result={aliases:[],pagination:{next:null}};
  else if(target.pathname.includes('/v13/deployments/'))result={id:target.pathname.split('/').at(-1),projectId:foreign?'prj_foreign':'prj_site',target:'production',readyState:'READY',createdAt:target.pathname.endsWith('/old')?1000:2000,meta:{nakwol_operation:operationId,nakwol_build:'a'.repeat(64),nakwol_runtime:'0.14.0'},url:'new.vercel.app'};
  else if(options.method==='POST'){writes++;active=target.pathname.split('/').at(-1);result={};}
  else result={id:'prj_site',accountId:'team_site',targets:{production:{id:active}}};
  return new Response(JSON.stringify(result));
 };
 const uploadImpl=async request=>{uploadCount++;operationId=request.operationId;if(conflict)active='foreign-current';return {id:provider==='vercel'?'new':'new-version'};};
 const adapter=createNativeHostingAdapter(document(provider),{root,fetchImpl,uploadImpl,apiToken:'private-test-token',leasePid:process.pid});
 return {adapter,root,seen,writes:()=>writes,uploads:()=>uploadCount,foreign:()=>foreign=true,conflict:()=>conflict=true};
}
for(const provider of ['cloudflare-workers','vercel'])test(`${provider}: scoped upload/promotion and exact previous rollback share operation receipt`,async t=>{
 const f=await fixture(t,provider),caps=await f.adapter({action:'capabilities'});assert.equal(caps.rollback,true);assert.equal(caps.inventoryComplete,true);assert.equal(f.writes(),0);
 const input={action:'deploy',operationId:'operation-1',expectedDeploymentId:'old',buildHash:'a'.repeat(64),runtimeVersion:'0.14.0'};const deployed=await f.adapter(input);assert.equal(deployed.deploymentId,'new');assert.equal(deployed.operationId,'operation-1');assert.equal(f.writes(),1);
 const recovered=await f.adapter({...input,action:'rollback',expectedDeploymentId:'new',targetDeploymentId:'old'});assert.ok(['old','recovered'].includes(recovered.deploymentId));assert.equal(recovered.operationId,'operation-1');assert.equal(f.writes(),2);assert.equal((await f.adapter({action:'current'})).deploymentId,recovered.deploymentId);
 assert.equal(JSON.stringify(f.seen).includes('private-test-token'),false);
});
test('native adapter never writes on stale expected ID, lost lease or a change during upload',async t=>{
 const f=await fixture(t,'cloudflare-workers'),input={action:'deploy',operationId:'operation-1',expectedDeploymentId:'wrong',buildHash:'a'.repeat(64),runtimeVersion:'0.14.0'};
 await assert.rejects(f.adapter(input),/changed|conflict/);assert.equal(f.uploads(),0);assert.equal(f.writes(),0);
 f.conflict();await assert.rejects(f.adapter({...input,expectedDeploymentId:'old'}),/changed|conflict/);assert.equal(f.writes(),0);
 await rm(join(f.root,'.nakwol/reports/hosting/operation.lock'));await assert.rejects(f.adapter({...input,expectedDeploymentId:'foreign-current'}),/lease|lock/);assert.equal(f.writes(),0);
});
test('Vercel foreign artifact is rejected before promotion',async t=>{const f=await fixture(t,'vercel');f.foreign();await assert.rejects(f.adapter({action:'deploy',operationId:'operation-1',expectedDeploymentId:'old',buildHash:'a'.repeat(64),runtimeVersion:'0.14.0'}),/binding|project/);assert.equal(f.writes(),0);});
