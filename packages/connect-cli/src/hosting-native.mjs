import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {parseHosting} from './shared/hosting-schema.mjs';
import {boundedBody} from './protection-inventory.mjs';
import {readHostingInventory} from './hosting-connection.mjs';

const identifier=/^[\w.-]{1,200}$/;
export function createNativeHostingAdapter(document,options={}){
 const binding=parseHosting(document),root=options.root||process.cwd(),workers=binding.provider==='cloudflare-workers';
 if(!['cloudflare-workers','vercel'].includes(binding.provider)||binding.mode!=='automatic'||!binding.controlledDeployments)throw new Error('Native automatic deployment requires controlled Workers or Vercel hosting.');
 const credential=options.apiToken||process.env[workers?'CLOUDFLARE_API_TOKEN':'VERCEL_TOKEN'];if(!credential)throw new Error('Native hosting credential is missing.');
 const fetchImpl=options.fetchImpl||globalThis.fetch,base=workers?'https://api.cloudflare.com/client/v4':'https://api.vercel.com';
 const resource=workers?'/accounts/'+binding.accountId+'/workers/scripts/'+binding.resourceId:'/v9/projects/'+binding.resourceId;
 const scoped=path=>workers?path:path+(path.includes('?')?'&':'?')+'teamId='+binding.teamId;
 const receiptName='.nakwol/reports/hosting/provider-operation.json';
 const checkedId=value=>{if(typeof value!=='string'||!identifier.test(value))throw new Error('Invalid native deployment identifier.');return value;};
 async function api(path,method='GET',body,allowMissing=false){
  const response=await fetchImpl(base+scoped(path),{method,redirect:'error',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  if(allowMissing&&response.status===404){await response.body?.cancel();return null;}
  const bytes=await boundedBody(response,1024*1024);if(!response.ok||!bytes.complete)throw new Error('Native hosting API request failed.');
  let data;try{data=JSON.parse(bytes.bytes);}catch{throw new Error('Native hosting API response is invalid.');}
  if(workers){if(data.success!==true||data.result===undefined)throw new Error('Native hosting API rejected the request.');return data.result;}return data;
 }
 async function privateFile(name){
  const directory=await realpath(resolve(root,'.nakwol/reports/hosting')),baseRoot=await realpath(root),rel=relative(baseRoot,directory);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw new Error('Native lease directory escapes the project.');
  let cursor=resolve(root,'.nakwol');for(const part of ['', 'reports','hosting']){if(part)cursor=join(cursor,part);const entry=await lstat(cursor);if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Native private directory is unsafe.');}
  const path=resolve(root,name);try{if((await lstat(path)).isSymbolicLink())throw new Error('Native receipt or lease uses a symbolic link.');}catch(error){if(error.code!=='ENOENT')throw error;}return path;
 }
 async function lease(){
  let value;try{value=JSON.parse(await readFile(await privateFile('.nakwol/reports/hosting/operation.lock'),'utf8'));}catch{throw new Error('Native deployment requires the release operation lease/lock.');}
  const expected=options.leasePid||process.ppid;if(value.pid!==expected||!Number.isSafeInteger(value.pid))throw new Error('Native operation lease owner differs from this release process.');
  try{process.kill(value.pid,0);}catch{throw new Error('Native operation lease owner is no longer running.');}
 }
 async function receipt(){try{const result=JSON.parse(await readFile(await privateFile(receiptName),'utf8'));if(result.provider!==binding.provider||result.resourceId!==binding.resourceId)return null;return result;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 async function save(value){await writeFile(await privateFile(receiptName),JSON.stringify({schemaVersion:1,provider:binding.provider,resourceId:binding.resourceId,...value})+'\n',{mode:0o600});}
 async function current(){
  const inventory=await readHostingInventory(binding,{fetchImpl,apiToken:credential}),stored=await receipt();let operationId;
  if(workers){const active=(await api(resource+'/deployments')).deployments?.[0];if(active?.id!==inventory.deploymentId)throw new Error('Native deployment changed during inventory.');operationId=/^nakwol:([\w-]{1,80})(?::|$)/.exec(active.annotations?.['workers/message']||'')?.[1];}
  else if(stored?.deploymentId===inventory.deploymentId)operationId=stored.operationId;
  return {schemaVersion:1,provider:binding.provider,resourceId:binding.resourceId,origins:inventory.origins,inventoryComplete:true,deploymentId:checkedId(inventory.deploymentId),...(operationId?{operationId}:{})};
 }
 async function expect(deploymentId){await lease();const live=await current();if(live.deploymentId!==deploymentId)throw new Error('Native serving deployment changed; conflict refused.');return live;}
 async function waitFor(deploymentId){
  for(let attempt=0;attempt<15;attempt++){const live=await current();if(live.deploymentId===deploymentId)return live;await new Promise(resolve=>setTimeout(resolve,1000));}
  throw new Error('Native promotion did not become the serving deployment.');
 }
 function vercelArtifact(value,id){if(value?.id!==id||value.projectId!==binding.resourceId||value.target!=='production'||value.readyState!=='READY')throw new Error('Native Vercel artifact project/production binding is invalid.');return value;}
 return async function handle(request){
  if(request.schemaVersion!==undefined&&request.schemaVersion!==1||request.provider!==undefined&&request.provider!==binding.provider||request.resourceId!==undefined&&request.resourceId!==binding.resourceId)throw new Error('Native adapter request binding is invalid.');
  if(request.action==='capabilities')return {...await current(),serializedDeployments:true,compareBeforeWrite:true,rollback:true};
  if(request.action==='current')return current();
  if(!['deploy','rollback'].includes(request.action)||!/^[-\w]{1,80}$/.test(request.operationId||'')||!/^[a-f0-9]{64}$/.test(request.buildHash||'')||!/^\d+\.\d+\.\d+$/.test(request.runtimeVersion||''))throw new Error('Native mutation request is invalid.');
  const before=await expect(checkedId(request.expectedDeploymentId));
  if(request.action==='deploy'){
   const upload=options.uploadImpl||(await import('./hosting-upload.mjs')).uploadNativeCandidate;
   const uploaded=await upload({...request,binding,root,apiToken:credential}),artifactId=checkedId(uploaded?.id);
   if(workers){const artifact=await api(resource+'/versions/'+artifactId);if(artifact.id!==artifactId||artifact.annotations?.['workers/message']!==`nakwol:${request.operationId}:${request.buildHash}:${request.runtimeVersion}`)throw new Error('Native Worker upload artifact binding is invalid.');}
   else{const artifact=vercelArtifact(await api('/v13/deployments/'+artifactId),artifactId);if(artifact.meta?.nakwol_operation!==request.operationId||artifact.meta?.nakwol_build!==request.buildHash||artifact.meta?.nakwol_runtime!==request.runtimeVersion)throw new Error('Native Vercel uploaded artifact binding is invalid.');}
   await expect(before.deploymentId);
   await save({operationId:request.operationId,phase:'promoting',previousDeploymentId:before.deploymentId,artifactId,...(!workers?{deploymentId:artifactId}:{})});
   if(workers){const result=await api(resource+'/deployments','POST',{strategy:'percentage',versions:[{version_id:artifactId,percentage:100}],annotations:{'workers/message':`nakwol:${request.operationId}`}});const deploymentId=checkedId(result.id);await save({operationId:request.operationId,phase:'promoted',previousDeploymentId:before.deploymentId,artifactId,deploymentId});return waitFor(deploymentId);}
   await api('/v10/projects/'+binding.resourceId+'/promote/'+artifactId,'POST',{});return waitFor(artifactId);
  }
  const stored=await receipt();if(!stored||stored.operationId!==request.operationId||stored.previousDeploymentId!==request.targetDeploymentId||before.operationId!==request.operationId)throw new Error('Native rollback is not bound to this operation.');
  const targetId=checkedId(request.targetDeploymentId);
  if(workers){
   const target=await api(resource+'/deployments/'+targetId),active=(await api(resource+'/deployments')).deployments?.[0];
   if(target.id!==targetId||target.versions?.length!==1||target.versions[0].percentage!==100||!(Date.parse(target.created_on)<Date.parse(active?.created_on)))throw new Error('Native rollback target is not a known older 100% deployment.');checkedId(target.versions[0].version_id);
   await expect(before.deploymentId);const result=await api(resource+'/deployments','POST',{strategy:'percentage',versions:target.versions,annotations:{'workers/message':`nakwol:${request.operationId}`}});
   const deploymentId=checkedId(result.id);await save({...stored,phase:'restored',deploymentId});return waitFor(deploymentId);
  }
  const target=vercelArtifact(await api('/v13/deployments/'+targetId),targetId),active=vercelArtifact(await api('/v13/deployments/'+before.deploymentId),before.deploymentId);
  if(!(target.createdAt<active.createdAt))throw new Error('Native rollback target must be the specified older deployment.');
  await expect(before.deploymentId);await save({...stored,phase:'restoring',deploymentId:targetId});await api('/v9/projects/'+binding.resourceId+'/rollback/'+targetId,'POST',{});return waitFor(targetId);
 };
}
export async function runNativeHostingAdapter(binding){
 try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>65536)throw new Error('Native adapter request exceeds limit.');}const result=await createNativeHostingAdapter(binding)(JSON.parse(input));process.stdout.write(JSON.stringify(result));}
 catch{process.stderr.write('Native hosting adapter failed.\n');process.exitCode=1;}
}
