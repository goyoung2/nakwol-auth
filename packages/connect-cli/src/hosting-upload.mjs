import {spawn} from 'node:child_process';
import {readFile,realpath,lstat,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {boundedBody} from './protection-inventory.mjs';

export const hostingToolVersions={'cloudflare-workers':{name:'wrangler',version:'4.119.0'},vercel:{name:'vercel',version:'62.1.0'}};
export async function uploadNativeCandidate(request,options={}){
 const {binding,root,apiToken,operationId,buildHash,runtimeVersion}=request,tool=hostingToolVersions[binding.provider];
 if(!tool)throw new Error('Native upload provider is unsupported.');
 const pkg=JSON.parse(await readFile(join(root,'package.json'))),installed=JSON.parse(await readFile(join(root,'node_modules',tool.name,'package.json')));
 if(pkg.devDependencies?.[tool.name]!==tool.version||installed.version!==tool.version)throw new Error('Native hosting CLI must match the reviewed exact dependency.');
 const name=typeof installed.bin==='string'?installed.bin:installed.bin?.[tool.name],base=await realpath(join(root,'node_modules',tool.name));
 if(typeof name!=='string')throw new Error('Native CLI executable is missing.');
 const executable=await realpath(resolve(base,name)),rel=relative(base,executable);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||!(await lstat(executable)).isFile())throw new Error('Native CLI executable escapes its package.');
 const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','TMPDIR','HOME','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
 const marker=`nakwol:${operationId}:${buildHash}:${runtimeVersion}`,output=join(root,'.nakwol/reports/hosting','upload-'+randomUUID()+'.jsonl');let args;
 if(binding.provider==='cloudflare-workers'){
  const config=JSON.parse(await readFile(join(root,'wrangler.nakwol.json')));
  if(config.name!==binding.resourceId||config.account_id&&config.account_id!==binding.accountId||config.preview_urls!==false||config.assets?.run_worker_first!==true)throw new Error('Native Worker must match the account, protect all assets and disable previews.');
  env.CLOUDFLARE_API_TOKEN=apiToken;env.CLOUDFLARE_ACCOUNT_ID=binding.accountId;env.WRANGLER_OUTPUT_FILE_PATH=output;env.CI='true';
  args=['versions','upload','--config','wrangler.nakwol.json','--message',marker];
 }else{
  try{const project=JSON.parse(await readFile(join(root,'.vercel/project.json')));
   if(project.projectId!==binding.resourceId||project.orgId!==binding.teamId)throw new Error('Native Vercel upload requires the exact linked project.');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  env.VERCEL_ORG_ID=binding.teamId;env.VERCEL_PROJECT_ID=binding.resourceId;env.CI='true';
  args=['deploy','--prod','--skip-domain','--yes','--token',apiToken,'--meta','nakwol_operation='+operationId,'--meta','nakwol_build='+buildHash,'--meta','nakwol_runtime='+runtimeVersion];
 }
 try{
  const stdout=await (options.run||run)(executable,args,{cwd:root,env});
  if(binding.provider==='cloudflare-workers'){
   const bytes=await readFile(output);if(bytes.length>1024*1024)throw new Error('Native upload receipt exceeds limit.');
   const records=bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(r=>r.type==='version-upload');
   if(records.length!==1||records[0].worker_name!==binding.resourceId||records[0].preview_url||records[0].preview_alias_url||!/^[-\w.]{1,200}$/.test(records[0].version_id||''))throw new Error('Native Worker upload receipt is invalid.');
   return {id:records[0].version_id};
  }
  const urls=stdout.trim().split(/\s+/).filter(v=>/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(v));if(urls.length!==1)throw new Error('Native Vercel upload URL is ambiguous.');
  const response=await (options.fetchImpl||fetch)('https://api.vercel.com/v13/deployments/'+new URL(urls[0]).hostname+'?teamId='+binding.teamId,{redirect:'error',headers:{Authorization:'Bearer '+apiToken},signal:AbortSignal.timeout(15000)});
  const bytes=await boundedBody(response,1024*1024);if(!response.ok||!bytes.complete)throw new Error('Native Vercel upload receipt lookup failed.');
  const result=JSON.parse(bytes.bytes);if(result.projectId!==binding.resourceId||result.target!=='production'||result.readyState!=='READY'||!/^[-\w.]{1,200}$/.test(result.id||''))throw new Error('Native Vercel upload receipt binding is invalid.');
  return {id:result.id};
 }finally{await rm(output,{force:true});}
}
function run(executable,args,options){return new Promise((resolveResult,reject)=>{
 const child=spawn(process.execPath,[executable,...args],{...options,stdio:['ignore','pipe','pipe'],windowsHide:true});let length=0,failed=false;const parts=[];
 const timer=setTimeout(()=>{failed=true;child.kill();},100000);
 child.stdout.on('data',part=>{length+=part.length;if(length>1024*1024){failed=true;child.kill();}else parts.push(part);});child.stderr.resume();
 child.on('error',()=>{clearTimeout(timer);reject(new Error('Native hosting CLI could not run.'));});
 child.on('close',code=>{clearTimeout(timer);if(failed||code!==0)reject(new Error('Native hosting upload failed or timed out.'));else resolveResult(Buffer.concat(parts).toString('utf8'));});
});}
