import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Exercise the packed CLI against the existing trusted local HTTPS server.
// This simulates hosting writes, not Cloudflare/Vercel API deployment.
export async function exerciseAutomaticRollout({root,command,url,enableProbe}) {
  const cookieName='NAKWOL_SMOKE_SESSION';
  const runtime=JSON.parse(await readFile(join(root,'.nakwol-connect.json'),'utf8')).protection.runtimeVersion;
  const stateFile=join(root,'automatic-state.json');
  await writeFile(stateFile,JSON.stringify({deploymentId:'old',operationId:null,writes:0,mode:'good'}));
  let probeCount=0;
  enableProbe(async(req)=>{
    probeCount++;
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    if(state.deploymentId==='new' && state.mode==='outage') return new Response(null,{status:503});
    if(req.headers.cookie==='smoke_session=member') return new Response('private');
    return new Response('denied',{status:401,headers:{'X-Nakwol-Gate':'v1','X-Nakwol-Runtime':runtime,'Cache-Control':'private, no-store'}});
  });
  const adapter=`import {readFile,writeFile} from 'node:fs/promises';
let input='';for await(const bytes of process.stdin)input+=bytes;
const request=JSON.parse(input),file=${JSON.stringify(stateFile)};
const state=JSON.parse(await readFile(file,'utf8'));
const binding={schemaVersion:1,provider:'custom-host',resourceId:'smoke-site',origins:[${JSON.stringify(url)}],inventoryComplete:true};
if(request.action==='capabilities')process.stdout.write(JSON.stringify({...binding,serializedDeployments:true,compareBeforeWrite:true,rollback:true}));
else {
 if(request.action!=='current'){
  if(state.deploymentId!==request.expectedDeploymentId)throw Error('Concurrent deployment');
  state.deploymentId=request.action==='deploy'?'new':'recovery';state.operationId=request.operationId;state.writes++;
  await writeFile(file,JSON.stringify(state));
 }
 process.stdout.write(JSON.stringify({...binding,deploymentId:state.deploymentId,operationId:state.operationId}));
}`;
  await mkdir(join(root,'.nakwol/reports'),{recursive:true});
  await writeFile(join(root,'automatic-adapter.mjs'),adapter);
  await command('protect','manifest','--deployment-id','old','--output-file','previous-manifest.json');
  const baseline=await command('protect','verify','--manifest','previous-manifest.json','--session-cookie-env',cookieName);
  assert.equal(baseline.releaseAccepted,true);
  await writeFile(join(root,'previous-report.json'),JSON.stringify(baseline));
  const config=JSON.parse(await readFile(join(root,'.nakwol-connect.json'),'utf8'));
  config.protection.automatic={enabled:true,provider:'custom-host',resourceId:'smoke-site',serializedDeployments:true,adapterFile:'automatic-adapter.mjs',adapterSha256:createHash('sha256').update(adapter).digest('hex'),credentialEnv:[],sessionCookieEnv:cookieName,previousManifest:'previous-manifest.json',previousReport:'previous-report.json'};
  await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify(config));
  await command('protect','update');
  await command('protect','manifest','--deployment-id','build-only','--output-file','candidate-manifest.json');
  const accepted=await command('protect','rollout','--candidate-manifest','candidate-manifest.json','--output-file','.nakwol/reports/success.json');
  assert.equal(accepted.status,'release-verified');assert.equal(accepted.releaseAccepted,true);
  // Restore the fixture baseline, then verify a failed deployment and recovery.
  await writeFile(stateFile,JSON.stringify({deploymentId:'old',operationId:null,writes:0,mode:'outage'}));
  let failure;
  try {await command('protect','rollout','--candidate-manifest','candidate-manifest.json','--output-file','.nakwol/reports/failure.json');}
  catch(error) {failure=error;}
  assert.equal(failure?.code,1);
  const recovered=JSON.parse(await readFile(join(root,'.nakwol/reports/failure.json'),'utf8'));
  assert.equal(recovered.status,'recovery-verified');assert.equal(recovered.releaseAccepted,false);
  assert.equal(recovered.recoveryVerified,true);
  assert.equal(JSON.parse(await readFile(stateFile,'utf8')).writes,2);
  assert.equal(JSON.stringify(recovered).includes('smoke_session=member'),false);
  // Existing workflows are preserved. Exercise opt-in generation in another project.
  const optInRoot=join(root,'automatic-setup');await mkdir(join(optInRoot,'dist'),{recursive:true});
  for(const file of ['package.json','index.html','automatic-adapter.mjs','previous-manifest.json','previous-report.json']) await writeFile(join(optInRoot,file),await readFile(join(root,file)));
  const newPackage=JSON.parse(await readFile(join(optInRoot,'package.json'),'utf8'));
  delete newPackage.scripts['nakwol:gate'];
  await writeFile(join(optInRoot,'package.json'),JSON.stringify(newPackage));
  await writeFile(join(optInRoot,'dist/index.html'),'private');
  const optIn=structuredClone(config);delete optIn.protection;
  await writeFile(join(optInRoot,'.nakwol-connect.json'),JSON.stringify(optIn));
  await command('protect','install','--provider','cloudflare-workers','--assets','dist','--url',url,{cwd:optInRoot});
  const installed=JSON.parse(await readFile(join(optInRoot,'.nakwol-connect.json'),'utf8'));
  installed.protection.automatic=config.protection.automatic;
  await writeFile(join(optInRoot,'.nakwol-connect.json'),JSON.stringify(installed));
  const setup=await command('protect','automate','--auto-merge',{cwd:optInRoot});
  assert.equal(setup.autoMerge,true);
  const workflow=await readFile(join(optInRoot,'.github/workflows/nakwol-gate-auto-merge.yml'),'utf8');
  assert.ok(workflow.includes('secrets.NAKWOL_UPDATE_GITHUB_TOKEN'));
  assert.ok(workflow.includes('ref: ${{ github.sha }}'));
  assert.equal(probeCount,baseline.requestCount+accepted.baselineVerification.requestCount+accepted.verification.requestCount+recovered.baselineVerification.requestCount+recovered.failedVerification.requestCount+recovered.recoveryVerification.requestCount);
  return {accepted:accepted.status,rejected:recovered.status,failedExit:failure.code,probeCount,hosting:'simulated adapter, live local HTTPS',optIn:setup.autoMerge};
}
