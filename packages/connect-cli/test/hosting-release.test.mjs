import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';
import {writeProjectConfig,readProjectConfig} from '../src/config.mjs';
import {installProtection} from '../src/protection.mjs';import {sha256} from '../src/protection-inventory.mjs';
import {connectHosting,verifyHosting} from '../src/hosting-connection.mjs';
import {initializeHosting,releaseHosting} from '../src/hosting-release.mjs';
import {RUNTIME_VERSION} from '../src/server/gate.mjs';
import {openHostingState,sealHostingState} from '../src/hosting-state.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'nakwol-hosting-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'dist'));await mkdir(join(root,'ops'));await writeFile(join(root,'index.html'),'<body></body>');await writeFile(join(root,'dist/index.html'),'PRIVATE-HOSTING-BYTES');
 await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'echo build'}}));
 await writeProjectConfig(root,{clientId:'site',authMode:'required',accessPolicy:'member',redirectUris:['https://site.test/']});await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
 const stateFile=join(root,'provider-fixture.json');await writeFile(stateFile,JSON.stringify({deploymentId:'old',writes:0,operationId:null,mode:'good'}));
 const adapter=`import {readFile,writeFile} from 'node:fs/promises';let text='';for await(const bytes of process.stdin)text+=bytes;const input=JSON.parse(text),file=${JSON.stringify(stateFile)},state=JSON.parse(await readFile(file,'utf8')),binding={schemaVersion:1,provider:'cloudflare-workers',resourceId:'site',origins:['https://site.test/'],inventoryComplete:true};if(input.action==='capabilities'){process.stdout.write(JSON.stringify({...binding,serializedDeployments:true,compareBeforeWrite:true,rollback:true}));}else{if(input.action!=='current'){if(input.expectedDeploymentId!==state.deploymentId)throw Error('conflict');state.writes++;state.deploymentId=(input.action==='deploy'?'new-':'recovery-')+state.writes;state.operationId=input.operationId;await writeFile(file,JSON.stringify(state));}process.stdout.write(JSON.stringify({...binding,deploymentId:state.deploymentId,operationId:state.operationId}));}`;
 await writeFile(join(root,'ops/adapter.mjs'),adapter);const config=await readProjectConfig(root);
 config.protection.automatic={enabled:true,provider:'cloudflare-workers',resourceId:'site',serializedDeployments:true,adapterFile:'ops/adapter.mjs',adapterSha256:sha256(adapter),credentialEnv:[],sessionCookieEnv:'NAKWOL_HOSTING_TEST_COOKIE',previousManifest:'.nakwol/reports/hosting/previous-manifest.json',previousReport:'.nakwol/reports/hosting/previous-report.json'};await writeProjectConfig(root,config);
 const binding={schemaVersion:1,clientId:'site',siteOrigin:'https://site.test',provider:'cloudflare-workers',accountId:'a'.repeat(32),resourceId:'site',teamId:'',mode:'automatic',controlledDeployments:true,origins:['https://site.test'],adapterFile:'ops/adapter.mjs'};
 const file=join(root,'nakwol-hosting.json');await writeFile(file,JSON.stringify(binding));await connectHosting({root,hostingFile:file});
 for(const [name,value]of Object.entries({CLOUDFLARE_API_TOKEN:'private-fixture-token',NAKWOL_RELEASE_STATE_KEY:'a'.repeat(64),NAKWOL_HOSTING_TEST_COOKIE:'session=member'})){const old=process.env[name];process.env[name]=value;t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});}
 const state=async()=>JSON.parse(await readFile(stateFile,'utf8')),change=async patch=>writeFile(stateFile,JSON.stringify({...await state(),...patch}));let probes=0;
 let recoveryProbes=0;
 const server=createServer(async(req,res)=>{probes++;const current=await state();if(current.deploymentId===current.badDeploymentId&&current.mode==='outage'){res.writeHead(503);res.end();return;}if(req.headers.cookie==='session=member'){res.writeHead(200);res.end('PRIVATE-HOSTING-BYTES');return;}const lag=current.deploymentId.startsWith('recovery-')&&recoveryProbes++<(current.recoveryLagProbes||0);res.writeHead(401,{'X-Nakwol-Gate':'v1','X-Nakwol-Runtime':lag?'0.0.0':RUNTIME_VERSION,'Cache-Control':'private, no-store'});res.end('denied');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const verificationFetchImpl=(url,init)=>{const parsed=new URL(url);return fetch('http://127.0.0.1:'+server.address().port+parsed.pathname+parsed.search,init);};
 const fetchImpl=async(url,init)=>{assert.equal(init.method,'GET');const value=String(url).endsWith('/deployments')?{deployments:[{id:(await state()).deploymentId,versions:[{version_id:'version',percentage:100}]}]}:String(url).endsWith('/scripts/site/subdomain')?{enabled:false,previews_enabled:false}:[];return new Response(JSON.stringify({success:true,result:value}));};
 return {root,fetchImpl,verificationFetchImpl,state,change,probes:()=>probes};
}
test('sealed baseline drives actual adapter subprocess and HTTP verification, retaining verified recovery',async t=>{
 const f=await fixture(t),initial=await initializeHosting(f);assert.equal(initial.status,'baseline-sealed-not-deployed');assert.equal((await f.state()).writes,0);
 const file=join(f.root,'.nakwol/reports/hosting/baseline.enc'),first=await readFile(file,'utf8');assert.equal(first.includes('session=member'),false);
 const good=await releaseHosting(f);assert.equal(good.status,'release-verified');assert.equal(good.releaseAccepted,true);assert.equal((await f.state()).writes,1);
 await f.change({mode:'outage',badDeploymentId:'new-2'});const bad=await releaseHosting(f);assert.equal(bad.status,'recovery-verified');assert.equal(bad.ok,false);assert.equal(bad.releaseAccepted,false);assert.equal((await f.state()).writes,3);
 assert.notEqual(await readFile(file,'utf8'),first);await f.change({mode:'good'});const next=await releaseHosting(f);assert.equal(next.releaseAccepted,true);assert.equal((await f.state()).writes,4);assert.ok(f.probes()>30);
});
test('invalid key/state and locked operation never deploy; normal cookie checks cannot accept deny-all',async t=>{
 const f=await fixture(t);await initializeHosting(f);const file=join(f.root,'.nakwol/reports/hosting/baseline.enc'),original=await readFile(file,'utf8');
 await writeFile(file,'invalid');await assert.rejects(releaseHosting(f),/invalid/);assert.equal((await f.state()).writes,0);await writeFile(file,original);
 process.env.NAKWOL_RELEASE_STATE_KEY='b'.repeat(64);await assert.rejects(releaseHosting(f),/invalid/);assert.equal((await f.state()).writes,0);process.env.NAKWOL_RELEASE_STATE_KEY='a'.repeat(64);
 const lock=join(f.root,'.nakwol/reports/hosting/operation.lock');await writeFile(lock,'owner');await assert.rejects(releaseHosting(f),/EEXIST/);assert.equal((await f.state()).writes,0);await rm(lock);
 const old=process.env.NAKWOL_PROBE_SESSION;process.env.NAKWOL_PROBE_SESSION='session=wrong';t.after(()=>{if(old===undefined)delete process.env.NAKWOL_PROBE_SESSION;else process.env.NAKWOL_PROBE_SESSION=old;});
 const proof=await verifyHosting(f);assert.equal(proof.ok,false);assert.equal(proof.releaseAccepted,false);assert.equal(proof.status,'normal-member-check-failed');
});

test('recovery waits for a blocked stale edge to converge and still requires complete final proof',async t=>{
 const f=await fixture(t);await initializeHosting(f);await f.change({mode:'outage',badDeploymentId:'new-1',recoveryLagProbes:8});
 const result=await releaseHosting(f);assert.equal(result.status,'recovery-verified');assert.equal(result.releaseAccepted,false);assert.equal(result.recoveryVerified,true);assert.equal(result.recoveryVerification.checks.every(c=>c.ok),true);assert.equal((await f.state()).writes,2);
});

test('sealed complete evidence remains readable when pretty printing alone exceeds the byte limit',async t=>{
 const f=await fixture(t);await initializeHosting(f);
 const file=join(f.root,'.nakwol/reports/hosting/baseline.enc'),binding=JSON.parse(await readFile(join(f.root,'.nakwol/hosting.json'),'utf8'));
 const state=openHostingState(binding,await readFile(file,'utf8'),process.env.NAKWOL_RELEASE_STATE_KEY);
 state.report.auditNotes=Array(700000).fill('');
 assert.ok(Buffer.byteLength(JSON.stringify(state.report))<4*1024*1024);
 assert.ok(Buffer.byteLength(JSON.stringify(state.report,null,2))>4*1024*1024);
 await writeFile(file,sealHostingState(binding,state,process.env.NAKWOL_RELEASE_STATE_KEY));
 const result=await releaseHosting(f);assert.equal(result.status,'release-verified');assert.equal((await f.state()).writes,1);
});
