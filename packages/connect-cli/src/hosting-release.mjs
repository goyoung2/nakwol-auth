import {readFile,writeFile,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseHosting} from './shared/hosting-schema.mjs';
import {readProjectConfig} from './config.mjs';
import {createProtectionManifest} from './protection.mjs';
import {readProtectionManifest} from './protection-inventory.mjs';
import {verifyProtection} from './protection-verify.mjs';
import {runRollout,readAutomaticConnection,validateAutomaticConfig} from './portable-rollout.mjs';
import {checkHosting} from './hosting-connection.mjs';
import {sealHostingState,openHostingState} from './hosting-state.mjs';
async function privateDirectory(root){
 const base=await realpath(root);let path=base;
 for(const part of ['.nakwol','reports','hosting']){path=join(path,part);try{const entry=await lstat(path);if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Hosting private directory is not a normal directory.');}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(path);}}
 return path;
}
async function privateFile(root,path){
 const base=await privateDirectory(root),target=resolve(root,path),rel=relative(base,target);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||!rel)throw new Error('Hosting evidence must stay under .nakwol/reports/hosting.');
 let cursor=target;while(cursor!==base){try{if((await lstat(cursor)).isSymbolicLink())throw new Error('Hosting evidence must not use symbolic links.');}catch(error){if(error.code!=='ENOENT')throw error;}cursor=dirname(cursor);}
 await mkdir(dirname(target),{recursive:true});return target;
}
async function locked(root,fn){
 const directory=await privateDirectory(root),lock=join(directory,'operation.lock');
 await writeFile(lock,JSON.stringify({pid:process.pid,operationId:randomUUID()}),{flag:'wx',mode:0o600});
 try{return await fn(directory);}finally{await unlink(lock);}
}
async function connection(root){const config=await readProjectConfig(root),binding=parseHosting(JSON.parse(await readFile(join(root,config?.protection?.hosting?.file||'.nakwol/hosting.json'))));
 if(binding.mode!=='automatic'||!binding.controlledDeployments)throw new Error('Hosting initialize/release require explicit automatic connection.');
 const reviewed=await readAutomaticConnection(root,config);
 if(reviewed.policy.adapterFile!==binding.adapterFile||reviewed.policy.provider!==binding.provider||reviewed.policy.resourceId!==binding.resourceId||config.clientId!==binding.clientId||config.protection.siteUrl!==binding.siteOrigin+'/')throw new Error('Hosting adapter binding differs from the connected site.');
 return {config,binding,...reviewed};
}
async function saveState(directory,binding,manifestFile,report){
 const manifest=await readProtectionManifest(manifestFile),manifestBytes=await readFile(manifestFile,'utf8');
 const content=sealHostingState(binding,{schemaVersion:1,manifest,manifestBytes,report},process.env.NAKWOL_RELEASE_STATE_KEY),temp=join(directory,'baseline-'+randomUUID()+'.tmp');
 await writeFile(temp,content,{flag:'wx',mode:0o600});await rename(temp,join(directory,'baseline.enc'));
}
export async function initializeHosting(options={}){
 const root=options.root||process.cwd(),{config,binding,policy}=await connection(root);
 // Validate the key before even creating evidence files.
 sealHostingState(binding,{schemaVersion:1,manifest:{},report:{}},process.env.NAKWOL_RELEASE_STATE_KEY);
 if(!process.env[policy.sessionCookieEnv])throw new Error('Normal member probe cookie is required.');
 return locked(root,async directory=>{
  const current=await checkHosting(options),file=join(directory,'initial-'+randomUUID()+'.manifest.json');
  await createProtectionManifest({root,deploymentId:current.deploymentId,outputFile:file});const manifest=await readProtectionManifest(file);
  const report=await verifyProtection({root,url:config.protection.siteUrl,manifest:file,deploymentId:current.deploymentId,expectRuntime:manifest.runtimeVersion,sessionCookieEnv:policy.sessionCookieEnv,alternateOrigins:current.origins.filter(o=>o!==config.protection.siteUrl).join(','),fetchImpl:options.verificationFetchImpl||globalThis.fetch});
  const after=await checkHosting(options);if(!report.releaseAccepted||after.deploymentId!==current.deploymentId||JSON.stringify(after.origins)!==JSON.stringify(current.origins))return {ok:false,status:'baseline-rejected',releaseAccepted:false};
  await saveState(directory,binding,file,report);return {ok:true,status:'baseline-sealed-not-deployed',deploymentId:current.deploymentId,stateFile:'.nakwol/reports/hosting/baseline.enc'};
 });
}
export async function releaseHosting(options={}){
 const root=options.root||process.cwd(),{binding,policy}=await connection(root);
 return locked(root,async directory=>{
  const file=join(directory,'baseline.enc');if((await lstat(file)).isSymbolicLink())throw new Error('Baseline must not be a symbolic link.');
  const state=openHostingState(binding,await readFile(file,'utf8'),process.env.NAKWOL_RELEASE_STATE_KEY);
  const manifestFile=await privateFile(root,policy.previousManifest),reportFile=await privateFile(root,policy.previousReport);
  // The manifest proof binds its original bytes. Preserve its canonical encoding.
  if(typeof state.manifestBytes!=='string')throw new Error('Baseline original manifest bytes are missing.');
  await writeFile(manifestFile,state.manifestBytes,{mode:0o600});
  await writeFile(reportFile,JSON.stringify(state.report)+'\n',{mode:0o600});await validateAutomaticConfig(root,await readProjectConfig(root));
  const nonce=randomUUID(),candidate=join(directory,nonce+'.candidate.json'),output=join(directory,nonce+'.rollout.json');
  await createProtectionManifest({root,deploymentId:'candidate-'+nonce,outputFile:candidate});
  const result=await runRollout({...options,root,candidateManifest:candidate,outputFile:output,fetchImpl:options.verificationFetchImpl||globalThis.fetch});
  if(result.status==='release-verified')await saveState(directory,binding,result.manifestFile,result.verification);
  else if(result.status==='recovery-verified')await saveState(directory,binding,output+'.recovery-manifest.json',result.recoveryVerification);
  return {...result,stateFile:'.nakwol/reports/hosting/baseline.enc'};
 });
}
