import {spawn} from 'node:child_process';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readProjectConfig} from './config.mjs';
import {readProtectionManifest,sha256} from './protection-inventory.mjs';
import {assetInventory,generatedAssetPaths,siteUrl} from './protection.mjs';
import {verifyProtection} from './protection-verify.mjs';
import {MAX_HOSTING_EVIDENCE_BYTES} from './hosting-state.mjs';

const id=/^[\w.-]{1,200}$/;
const envName=/^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const inside=(root,path)=>{const rel=relative(root,path);return !isAbsolute(rel) && rel!=='..' && !rel.startsWith('../') && !rel.startsWith('..\\');};
async function localFile(root,name) {
  if(typeof name!=='string' || !name || isAbsolute(name)) throw new Error('Automatic adapter/evidence must be a repository-relative file.');
  const base=await realpath(root),path=resolve(base,name);
  if(!inside(base,path)) throw new Error('Automatic file escapes the project.');
  let cursor=path;
  while(cursor!==base) {if((await lstat(cursor)).isSymbolicLink()) throw new Error('Automatic files must not use symbolic links.');cursor=dirname(cursor);}
  if(!(await lstat(path)).isFile()) throw new Error('Automatic file is not a regular file.');
  return path;
}
async function jsonFile(file) {
  const bytes=await readFile(file);
  if(bytes.length>MAX_HOSTING_EVIDENCE_BYTES) throw new Error('Automatic evidence exceeds its size limit.');
  return JSON.parse(bytes);
}
export async function readAutomaticConnection(root,config) {
  const policy=config?.protection?.automatic;
  if(policy?.enabled!==true) throw new Error('Automatic updates require explicit opt-in and a reviewed adapter.');
  if(config.authMode!=='required' || config.accessPolicy!=='member' || !config.clientId) throw new Error('Automatic updates require required/member protection.');
  if(!id.test(policy.provider||'') || !id.test(policy.resourceId||'') || policy.serializedDeployments!==true) throw new Error('Automatic deployment binding and external serialization are required.');
  const reserved=['GITHUB_TOKEN','GH_TOKEN','DISCORD_CLIENT_SECRET','DISCORD_BOT_TOKEN','SESSION_SECRET','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','PATH','SYSTEMROOT','TEMP','TMP','TMPDIR'];
  const canonical=Array.isArray(policy.credentialEnv)?policy.credentialEnv.map(name=>typeof name==='string'?name.toUpperCase():''):[];
  if(!envName.test(policy.sessionCookieEnv||'') || !Array.isArray(policy.credentialEnv) || policy.credentialEnv.length>12 || new Set(canonical).size!==canonical.length || !policy.credentialEnv.every((name,i)=>envName.test(name) && canonical[i]!==policy.sessionCookieEnv.toUpperCase() && !reserved.includes(canonical[i]))) throw new Error('Automatic credentials require explicit isolated environment names.');
  const adapter=await localFile(root,policy.adapterFile);
  const source=await readFile(adapter);
  if(!adapter.endsWith('.mjs') || source.length>256*1024 || sha256(source)!==policy.adapterSha256) throw new Error('Automatic adapter hash does not match reviewed code.');
  if(typeof policy.previousManifest!=='string' || typeof policy.previousReport!=='string') throw new Error('Automatic baseline locations are required.');
  return {policy,adapter};
}
export async function validateAutomaticConfig(root,config) {
  const connection=await readAutomaticConnection(root,config),{policy}=connection;
  const manifestFile=await localFile(root,policy.previousManifest);
  const reportFile=await localFile(root,policy.previousReport);
  const previous=await readProtectionManifest(manifestFile);
  const proof=await jsonFile(reportFile),binding=proof.evidenceBinding;
  if(proof.releaseAccepted!==true || proof.ok!==true || proof.manifestUnchanged!==true || binding?.deploymentId!==previous.deploymentId || binding.buildHash!==previous.buildHash || binding.manifestHash!==previous.manifestHash || binding.runtimeVersion!==previous.runtimeVersion || proof.expectedRuntime!==previous.runtimeVersion || proof.authenticatedChecks?.length!==previous.files.length || !proof.authenticatedChecks.every(check=>check.ok===true) || !proof.checks?.length || !proof.checks.every(check=>check.ok===true) || !proof.origins?.includes(config.protection.siteUrl)) throw new Error('Automatic baseline needs a matching strong verification proof.');
  if(!Array.isArray(proof.origins))throw new Error('Automatic baseline origin inventory is invalid.');
  return {...connection,previous,manifestFile,reportFile,previousOrigins:[...new Set(proof.origins.map(siteUrl))].sort()};
}

// The adapter is owner-reviewed CI code, not a sandbox for untrusted plugins.
// Its JSON and stderr never become shell commands or raw diagnostic output.
async function invokeAdapter(root,connection,action,payload={}) {
  if(sha256(await readFile(connection.adapter))!==connection.policy.adapterSha256) throw new Error('Automatic adapter changed during rollout.');
  const environment={};
  for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','TMPDIR']) if(process.env[name]) environment[name]=process.env[name];
  for(const name of connection.policy.credentialEnv) {
    if(!process.env[name]) throw new Error('Automatic adapter credential is missing.');
    environment[name]=process.env[name];
  }
  const request={schemaVersion:1,action,provider:connection.policy.provider,resourceId:connection.policy.resourceId,...payload};
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,[connection.adapter],{cwd:root,env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const parts=[];let length=0,failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill();},120000);
    child.stdout.on('data',bytes=>{length+=bytes.length;if(length>256*1024){failed=true;child.kill();}else parts.push(bytes);});
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Automatic adapter could not run.'));});
    child.on('close',code=>{
      clearTimeout(timer);
      if(failed || code!==0) {reject(new Error('Automatic adapter failed or timed out.'));return;}
      try {
        const output=Buffer.concat(parts).toString('utf8');
        if(connection.policy.credentialEnv.some(name=>output.includes(process.env[name]))) throw new Error();
        resolveResult(JSON.parse(output));
      } catch {reject(new Error('Automatic adapter returned invalid or sensitive JSON.'));}
    });
    child.stdin.end(JSON.stringify(request));
  });
}
function descriptor(value,policy,origins=null) {
  if(value?.schemaVersion!==1 || value.provider!==policy.provider || value.resourceId!==policy.resourceId || value.inventoryComplete!==true || !Array.isArray(value.origins) || !value.origins.length || value.origins.length>100) throw new Error('Automatic adapter resource/origin binding is invalid.');
  const normalized=[...new Set(value.origins.map(siteUrl))].sort();
  if(normalized.length!==value.origins.length || origins && origins.some(origin=>!normalized.includes(origin))) throw new Error('Automatic origin inventory lost a known origin; manual closure review is required.');
  if(value.deploymentId!==undefined && !id.test(value.deploymentId)) throw new Error('Automatic deployment identifier is invalid.');
  // Retain only public protocol fields; an adapter cannot inject secrets into reports.
  return {schemaVersion:1,provider:policy.provider,resourceId:policy.resourceId,origins:normalized,inventoryComplete:true,...(value.deploymentId?{deploymentId:value.deploymentId}:{}),...(typeof value.operationId==='string' && /^[\w-]{1,80}$/.test(value.operationId)?{operationId:value.operationId}:{})};
}
async function candidateInventory(root,config,file) {
  const manifest=await readProtectionManifest(file);
  if(manifest.runtimeVersion!==config.protection.runtimeVersion) throw new Error('Candidate manifest runtime differs from installed configuration.');
  const inventory=await assetInventory(root,config.protection.assetsDirectory,generatedAssetPaths(config.protection));
  if(inventory.paths.length!==manifest.files.length || manifest.files.some(file=>!inventory.paths.includes(file.path))) throw new Error('Candidate manifest does not cover the asset inventory.');
  const directory=await realpath(resolve(root,config.protection.assetsDirectory));
  for(const file of manifest.files) {
    if(file.size>1024*1024) throw new Error('Automatic verification is bounded to 1 MiB per asset; manual release review is required.');
    const target=await realpath(resolve(directory,decodeURIComponent(file.path.slice(1))));
    if(!inside(directory,target)) throw new Error('Candidate asset escapes the build directory.');
    const bytes=await readFile(target);
    if(bytes.length!==file.size || sha256(bytes)!==file.sha256) throw new Error('Candidate manifest local bytes changed.');
  }
  return manifest;
}

export async function runRollout(options={}) {
  const root=options.root || process.cwd(),config=await readProjectConfig(root);
  const connection=await validateAutomaticConfig(root,config),{policy,previous}=connection;
  if(!options.outputFile || !options.candidateManifest) throw new Error('Automatic rollout requires --candidate-manifest and --output-file.');
  if(!process.env[policy.sessionCookieEnv]) throw new Error('Automatic rollout requires a normal authenticated probe session.');
  const candidate=await candidateInventory(root,config,options.candidateManifest);
  const output=resolve(root,options.outputFile),outputDirectory=await realpath(dirname(output));
  const assets=await realpath(resolve(root,config.protection.assetsDirectory));
  if(!inside(await realpath(root),outputDirectory) || inside(assets,outputDirectory)) throw new Error('Automatic reports must stay in the project outside public assets.');
  const capabilities=await invokeAdapter(root,connection,'capabilities');
  const base=descriptor(capabilities,policy);
  if(connection.previousOrigins.some(origin=>!base.origins.includes(origin)))throw new Error('Automatic inventory lost a baseline origin; manual closure review is required.');
  if(capabilities.serializedDeployments!==true || capabilities.compareBeforeWrite!==true || capabilities.rollback!==true) throw new Error('Automatic adapter lacks required recovery/compare capabilities.');
  if(!base.origins.includes(config.protection.siteUrl)) throw new Error('Automatic adapter does not serve the registered origin.');
  const track=value=>{const result=descriptor(value,policy,base.origins);base.origins=result.origins;return result;};
  const current=async()=>track(await invokeAdapter(root,connection,'current'));
  const first=await current();
  if(first.deploymentId!==previous.deploymentId) throw new Error('Automatic baseline is not the current deployment.');
  const operationId=randomUUID();
  const journal={schemaVersion:1,provider:policy.provider,resourceId:policy.resourceId,operationId,ok:false,releaseAccepted:false,journalPersisted:true,status:'baseline-checking',previousDeploymentId:previous.deploymentId};
  await writeFile(output,JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600});
  const save=async patch=>{
    Object.assign(journal,patch);
    try {await writeFile(output,JSON.stringify(journal,null,2)+'\n');} catch {journal.journalPersisted=false;}
    return journal;
  };
  const verify=async(manifestFile,manifest)=>verifyProtection({root,provider:'custom',url:config.protection.siteUrl,manifest:manifestFile,deploymentId:manifest.deploymentId,expectRuntime:manifest.runtimeVersion,sessionCookieEnv:policy.sessionCookieEnv,alternateOrigins:base.origins.filter(origin=>origin!==config.protection.siteUrl).join(','),fetchImpl:options.fetchImpl || globalThis.fetch});
  async function verifyConverged(file,manifest,expectedDeploymentId) {
    for(let attempt=0;attempt<3;attempt++) {
      const proof=await verify(file,manifest);
      // Retry edge propagation only while every anonymous path remains blocked.
      // Exposure, incomplete evidence and inventory conflicts require recovery.
      if(proof.releaseAccepted||attempt===2||!proof.checks?.length||!proof.checks.every(check=>check.authorizationBlocked===true))return proof;
      const live=await current();
      if(live.deploymentId!==expectedDeploymentId||live.operationId!==operationId||JSON.stringify(live.origins)!==JSON.stringify(proof.origins?.slice().sort()))return proof;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  const baseline=await verify(connection.manifestFile,previous);
  if(!baseline.releaseAccepted) return save({status:'baseline-rejected',baselineVerification:baseline});
  const baselineAfter=await current();
  if(baselineAfter.deploymentId!==first.deploymentId || JSON.stringify(baselineAfter.origins)!==JSON.stringify(baseline.origins?.slice().sort())) return save({status:'deployment-conflict',baselineVerification:baseline});
  await save({status:'deploying',baselineVerification:baseline});
  if(!journal.journalPersisted) return save({status:'journal-failed'});
  let deployed;
  try {
    deployed=track(await invokeAdapter(root,connection,'deploy',{operationId,expectedDeploymentId:first.deploymentId,buildHash:candidate.buildHash,runtimeVersion:candidate.runtimeVersion}));
    if(!deployed.deploymentId || deployed.deploymentId===first.deploymentId || deployed.operationId!==operationId) throw new Error('Automatic deployment result is not bound to this operation.');
  } catch {
    // A timed-out write may have committed. Recover only an exact operation receipt.
    try {deployed=await current();} catch {return save({status:'deployment-indeterminate'});}
    if(deployed.deploymentId===first.deploymentId) return save({status:'deployment-failed',failedVerification:await verify(connection.manifestFile,previous)});
    if(deployed.operationId!==operationId) return save({status:'deployment-indeterminate'});
    await save({status:'deployment-indeterminate',deploymentId:deployed.deploymentId});
    return recover();
  }
  const candidateFile=output+'.manifest.json';
  const boundCandidate={...candidate,deploymentId:deployed.deploymentId};delete boundCandidate.manifestHash;
  await save({status:'verifying',deploymentId:deployed.deploymentId});
  if(!journal.journalPersisted) return recover();
  let verification;
  try {
    await writeFile(candidateFile,JSON.stringify(boundCandidate,null,2)+'\n',{flag:'wx',mode:0o600});
    if((await current()).deploymentId!==deployed.deploymentId) return save({status:'deployment-conflict'});
    verification=await verifyConverged(candidateFile,boundCandidate,deployed.deploymentId);
    const after=await current();
    if(after.deploymentId!==deployed.deploymentId || after.operationId!==operationId || JSON.stringify(after.origins)!==JSON.stringify(verification.origins?.slice().sort())) return save({status:'deployment-conflict',failedVerification:verification});
    if(verification.releaseAccepted) {
      await save({ok:true,releaseAccepted:true,status:'release-verified',verification,manifestFile:candidateFile});
      if(journal.journalPersisted) return journal;
      await save({ok:false,releaseAccepted:false,status:'journal-failed'});
      return recover();
    }
    await save({status:'release-rejected',failedVerification:verification});
  } catch {await save({status:'release-indeterminate'});}
  return recover();

  async function recover() {
    try {
      const before=await current();
      if(before.deploymentId!==deployed.deploymentId || before.operationId!==operationId) return save({status:'recovery-conflict'});
      await save({status:'recovering'});
      const restored=track(await invokeAdapter(root,connection,'rollback',{operationId,expectedDeploymentId:deployed.deploymentId,targetDeploymentId:first.deploymentId,buildHash:previous.buildHash,runtimeVersion:previous.runtimeVersion}));
      if(!restored.deploymentId || restored.deploymentId===deployed.deploymentId || restored.operationId!==operationId) throw new Error('Recovery result is not bound to this operation.');
      const serving=await current();
      if(serving.deploymentId!==restored.deploymentId || serving.operationId!==operationId) return save({status:'recovery-conflict'});
      const file=output+'.recovery-manifest.json',manifest={...previous,deploymentId:restored.deploymentId};delete manifest.manifestHash;
      await writeFile(file,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
      const proof=await verifyConverged(file,manifest,restored.deploymentId),after=await current();
      if(after.deploymentId!==restored.deploymentId || after.operationId!==operationId || JSON.stringify(after.origins)!==JSON.stringify(proof.origins?.slice().sort())) return save({status:'recovery-conflict',recoveryVerification:proof});
      return save({ok:false,releaseAccepted:false,status:proof.releaseAccepted?'recovery-verified':'recovery-failed',recoveryVerified:proof.releaseAccepted,recoveryDeploymentId:restored.deploymentId,recoveryVerification:proof});
    } catch {return save({ok:false,releaseAccepted:false,status:'recovery-indeterminate',recoveryVerified:false});}
  }
}
