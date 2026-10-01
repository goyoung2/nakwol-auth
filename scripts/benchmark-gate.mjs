import {createServer,request as httpRequest,Agent} from 'node:http';
import {Readable} from 'node:stream';
import {once,EventEmitter} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,cp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {verifyProtection} from '../packages/connect-cli/src/protection-verify.mjs';
import {generateFixture} from '../tests/fixtures/gate-benchmark/generator.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const allStates=['cold','warm','lease-expired','control-expired','access-expired','revisit','role-expired'];
export function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;}
function summary(runs){const result={};for(const key of ['wallMs','imageBatchMs','htmlTtfbMs','imageTtfbP95Ms','authWallP95Ms','processCpuMs','bytes','requests','errors'])result[key]={p50:percentile(runs.map(r=>r[key]).filter(Number.isFinite),.5),p95:percentile(runs.map(r=>r[key]).filter(Number.isFinite),.95),p99:percentile(runs.map(r=>r[key]).filter(Number.isFinite),.99)};return result;}
function cookies(response,previous=''){const jar=new Map(previous.split('; ').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));for(const item of response.headers.getSetCookie()){const pair=item.split(';')[0],i=pair.indexOf('=');if(pair.slice(i+1))jar.set(pair.slice(0,i),pair.slice(i+1));else jar.delete(pair.slice(0,i));}return [...jar].map(([k,v])=>k+'='+v).join('; ');}
const counts=()=>({me:0,exchange:0,refresh:0,control:0,observations:0,centralWallMs:0});

export async function runBenchmark(options={}){
  const config={profile:'local-lease',concurrency:30,isolates:1,authDelayMs:100,imageKiB:10,warmups:10,samples:30,states:allStates,...options};
  if(!['local-lease','bounded-control'].includes(config.profile)||![1,10].includes(config.isolates)||![6,30,300].includes(config.concurrency)||!Number.isInteger(config.samples)||config.samples<1||!Number.isInteger(config.warmups)||config.warmups<0||!Number.isFinite(config.authDelayMs)||config.authDelayMs<0||config.states.some(s=>!allStates.includes(s)))throw new Error('Invalid benchmark configuration');
  const fixture=await generateFixture({imageKiB:config.imageKiB,seed:'nakwol-t11-731'});
  const sourceHashes={};
  for(const path of ['scripts/benchmark-gate.mjs','tests/fixtures/gate-benchmark/generator.mjs',...['gate','session','control','observations','login'].map(name=>'packages/connect-cli/src/server/'+name+'.mjs')])sourceHashes[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
  const assets=fixture.assets;
  const paths=[...assets.keys()];
  const nativeFetch=globalThis.fetch,realNow=Date.now;
  let now=1900000000000,counter=counts(),active,sequence=0,protectedMode=true,assetCalls=0;
  const context=new AsyncLocalStorage();
  const directory=await mkdtemp(join(tmpdir(),'nakwol-benchmark-'));
  const gates=[];
  let server;
  const agent=new Agent({keepAlive:true,maxSockets:config.concurrency,maxFreeSockets:config.concurrency});
  const transportEvents=new EventEmitter(),primed=[];
  try{
    for(let i=0;i<config.isolates;i++){const dir=join(directory,String(i));await cp(join(root,'packages/connect-cli/src/server'),dir,{recursive:true});gates.push(await import(pathToFileURL(join(dir,'gate.mjs')).href));}
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const publicKeys=JSON.stringify({bench:await crypto.subtle.exportKey('jwk',pair.publicKey)});
    Date.now=()=>now;
    const proof=()=>({sessionId:active.id,userId:'synthetic-member',generation:counter.refresh,clientId:active.settings.clientId,siteOrigin:'https://benchmark.test',source:'role',policyVersion:1,controlVersion:1,verifiedAt:now,leaseUntil:now+(active.roleShort?60000:300000),authorizationEvidenceValidUntil:active.roleShort?active.evidenceUntil:now+900000,sessionExpiresAt:Math.min(now+3600000,active.absoluteUntil),absoluteExpiresAt:active.absoluteUntil});
    globalThis.fetch=async(input,init)=>{
      const path=new URL(input).pathname,begin=performance.now();
      if(config.authDelayMs)await new Promise(r=>setTimeout(r,config.authDelayMs));
      let result;
      if(path.endsWith('/control')){
        counter.control++;
        const doc={schemaVersion:1,audience:'nakwol-control-v1',clientId:active.settings.clientId,siteOrigin:'https://benchmark.test',version:1,appEpoch:1,appStatus:'active',policyFloor:1,revocations:[],issuedAt:now,expiresAt:now+30000};
        const payload=Buffer.from(JSON.stringify(doc)).toString('base64url');
        result=Response.json({kid:'bench',payload,signature:Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode('bench.'+payload))).toString('base64url')});
      }else if(path.endsWith('/code-exchange')){counter.exchange++;result=Response.json({ok:true,session:proof(),handle:'h'.repeat(43)});}
      else if(path.endsWith('/refresh')){counter.refresh++;result=active.roleShort&&now>=active.evidenceUntil?new Response(null,{status:403}):Response.json({ok:true,session:proof()});}
      else if(path.endsWith('/observations')){counter.observations++;result=Response.json({ok:true});}
      else throw new Error('Unexpected central endpoint '+path);
      counter.centralWallMs+=performance.now()-begin;return result;
    };
    const serveAsset=async request=>{
      assetCalls++;const pathname=new URL(request.url).pathname;const item=assets.get(pathname==='/'?'/index.html':pathname);
      const timing=context.getStore();if(timing)timing.authWallMs=performance.now()-timing.at;
      if(!item)return new Response(null,{status:404});
      const conditional=request.headers.get('If-None-Match')===item.etag;
      return new Response(conditional||request.method==='HEAD'?null:item.body,{status:conditional?304:200,headers:{'Content-Type':item.contentType,ETag:item.etag}});
    };
    const env=()=>({sessionSecret:'synthetic-benchmark-key-01234567890123456789',siteCredential:'synthetic-credential',controlProfile:config.profile,controlPublicKeys:publicKeys,serveAsset});
    const invoke=(request,index=0)=>gates[index].createGate(active.settings)(request,env());
    server=createServer(async(req,res)=>{
      if(req.url==='/__benchmark/transport-prime'){primed.push(res);transportEvents.emit('prime');return;}
      const timing={at:performance.now(),authWallMs:null};
      try{
        const response=await context.run(timing,()=>{const request=new Request('https://benchmark.test'+req.url,{method:req.method,headers:req.headers});const index=Number(req.headers['x-bench-isolate']??0);return protectedMode?invoke(request,index):serveAsset(request);});
        res.statusCode=response.status;
        for(const [k,v] of response.headers)if(k!=='set-cookie')res.setHeader(k,v);
        if(response.headers.getSetCookie().length)res.setHeader('Set-Cookie',response.headers.getSetCookie());
        if(timing.authWallMs!==null)res.setHeader('X-Benchmark-Auth-Wall',String(timing.authWallMs));
        res.end(Buffer.from(await response.arrayBuffer()));
      }catch(error){res.statusCode=500;res.end('benchmark server error');process.stderr.write(String(error)+'\n');}
    });
    server.listen({port:0,host:'127.0.0.1',backlog:2048});await once(server,'listening');const local='http://127.0.0.1:'+server.address().port;
    async function request(path,cookie='',extra={}){
      try{return await new Promise((resolve,reject)=>{
        const outgoing=httpRequest(local+path,{agent,method:extra.method??'GET',headers:{Cookie:cookie,...extra.headers}},incoming=>{
          const headers=new Headers();for(let i=0;i<incoming.rawHeaders.length;i+=2)headers.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
          const empty=[204,205,304].includes(incoming.statusCode)||extra.method==='HEAD';
          resolve(new Response(empty?null:Readable.toWeb(incoming),{status:incoming.statusCode,headers}));
          if(empty)incoming.resume();
        });outgoing.on('error',reject);outgoing.end();
      });}
      catch(error){const cause=error.cause;throw new Error(JSON.stringify({transport:'local-http',host:local,path,message:error.message,cause: cause?.message,code:cause?.code}),{cause:error});}
    }
    // Establish the driver's connection pool outside timed gate workloads. This
    // avoids measuring Windows TCP burst acceptance as authorization latency.
    const transportAt=performance.now(),primeTasks=[];
    for(let target=10;target<=config.concurrency+9;target+=10){
      const limit=Math.min(target,config.concurrency);
      while(primeTasks.length<limit)primeTasks.push(request('/__benchmark/transport-prime'));
      while(primed.length<limit)await once(transportEvents,'prime',{signal:AbortSignal.timeout(10000)});
    }
    for(const response of primed){response.statusCode=204;response.end();}
    await Promise.all(primeTasks);
    const transportPreparation={requests:primeTasks.length,wallMs:performance.now()-transportAt,concurrentHeldResponses:primed.length,includedInWorkload:false};
    async function prepare(state){
      now=1900000000000;
      active={id:'bench-session-'+(++sequence),settings:{clientId:'bench-'+sequence,siteUrl:'https://benchmark.test/',authOrigin:'https://auth.benchmark.test',accessPolicy:'member'},absoluteUntil:now+86400000,roleShort:state==='role-expired',evidenceUntil:now+60000};
      counter=counts();const at=performance.now();
      const start=await request('/__nakwol/start');const stateId=new URL(start.headers.get('Location')).searchParams.get('state');
      const callback=await request('/__nakwol/callback?state='+stateId+'&code=synthetic',cookies(start));
      if(callback.status!==303)throw new Error('Fixture login failed '+callback.status);
      let cookie=cookies(callback);
      const login={wallMs:performance.now()-at,central:{...counter}};
      if(state!=='cold')await Promise.all(Array.from({length:config.isolates},async(_,isolate)=>{const response=await request('/',cookie,{headers:{'X-Bench-Isolate':String(isolate)}});if(response.status!==200)throw new Error('Fixture warmup failed '+response.status);await response.arrayBuffer();}));
      if(state==='lease-expired')now+=300001;
      if(state==='control-expired')now+=30001;
      if(state==='access-expired')now+=86400001;
      if(state==='role-expired')now+=60001;
      counter=counts();assetCalls=0;return {cookie,login};
    }
    async function batch(state,cookie){
      const begin=performance.now(),cpu=process.cpuUsage();let index=0,bytes=0,errors=0,responses304=0,htmlTtfbMs=null,imageStart=null,imageFinish=null;
      const images=[],auth=[],statuses={};
      await Promise.all(Array.from({length:Math.min(config.concurrency,paths.length)},async()=>{
        for(;;){const n=index++;if(n>=paths.length)return;const path=paths[n],image=/\.(png|webp)$/.test(path);const at=performance.now();if(image&&imageStart===null)imageStart=at;
          const item=assets.get(path);const response=await request(path,cookie,{headers:{'X-Bench-Isolate':String(n%config.isolates),...(state==='revisit'?{'If-None-Match':item.etag}:{})}});
          const ttfb=performance.now()-at;if(path==='/index.html')htmlTtfbMs=ttfb;if(image)images.push(ttfb);
          const wall=response.headers.get('X-Benchmark-Auth-Wall');if(wall!==null)auth.push(Number(wall));
          statuses[response.status]=(statuses[response.status]??0)+1;
          const expected=state==='access-expired'?401:state==='role-expired'?403:state==='revisit'?304:200;
          if(response.status!==expected)errors++;
          if(response.status===304)responses304++;
          bytes+=(await response.arrayBuffer()).byteLength;if(image)imageFinish=performance.now();
        }
      }));
      const usage=process.cpuUsage(cpu);
      return {requests:paths.length,bytes,errors,statuses,responses304,wallMs:performance.now()-begin,imageBatchMs:imageFinish-imageStart,htmlTtfbMs,imageTtfbP95Ms:percentile(images,.95),authWallP95Ms:percentile(auth,.95),processCpuMs:(usage.user+usage.system)/1000,assetCalls,central:{...counter}};
    }
    active={settings:{clientId:'verification',siteUrl:'https://benchmark.test/',authOrigin:'https://auth.benchmark.test',accessPolicy:'member'}};
    const protectVerify=await verifyProtection({provider:'custom',url:'https://benchmark.test/',paths:paths.filter(p=>p!=='/').join(','),expectRuntime:'0.14.0',fetchImpl:(url,init)=>invoke(new Request(url,init))});
    if(!protectVerify.ok)throw new Error('protect verify failed');
    const scenarios=[];
    for(const state of config.states){
      const runs=[],logins=[];
      for(let iteration=0;iteration<config.warmups+config.samples;iteration++){
        protectedMode=true;const prepared=await prepare(state);const run=await batch(state,prepared.cookie);
        if(run.errors)throw new Error('Unexpected benchmark statuses '+JSON.stringify({state,...run}));
        if(iteration>=config.warmups){runs.push(run);logins.push(prepared.login);}
      }
      scenarios.push({state,runs,login:logins,summary:summary(runs)});
      if(config.progress)process.stderr.write(`${state}: ${config.samples} measured batches\n`);
    }
    const baselineRuns=[];protectedMode=false;
    for(let i=0;i<config.warmups+config.samples;i++){counter=counts();assetCalls=0;const run=await batch('warm','');if(i>=config.warmups)baselineRuns.push(run);}
    const baseline={runs:baselineRuns,summary:summary(baselineRuns)};
    const warm=scenarios.find(s=>s.state==='warm');
    const baselineP95=baseline.summary.wallMs.p95;
    const acceptance={warmCentralZero:warm?warm.runs.every(r=>r.central.refresh===0&&r.central.control===0&&r.central.me===0):null,batchBudgetMs:Math.max(100,baselineP95*.1),addedBatchP95Ms:warm?warm.summary.wallMs.p95-baselineP95:null,edgeCpuTarget:null,browserSSO:null};
    acceptance.warmBatchWithinBudget=warm?acceptance.addedBatchP95Ms<=acceptance.batchBudgetMs:null;
    return {schemaVersion:1,at:new Date(realNow()).toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes,config,fixture:fixture.manifest,measurement:{engine:'node-http',runtime:process.version,platform:process.platform,hostname:'loopback',isolate:'independent Node ESM module graphs; not Cloudflare workerd isolates',auth:'synthetic central session/refresh and signed control responses',transportPreparation,edgeCpuMeasured:false,cpu:'batch process.cpuUsage includes client/server/assets; not per-request Worker CPU',authWall:'gate entry to protected asset callback; includes crypto/control/refresh, scheduling; not CPU',ttfb:'Node HTTP response headers, body consumed separately',browserPaintMeasured:false,discordCallsMeasured:false},protectVerify:{ok:protectVerify.ok,requestCount:protectVerify.requestCount},scenarios,baseline,acceptance};
  }finally{
    globalThis.fetch=nativeFetch;Date.now=realNow;agent.destroy();
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await rm(directory,{recursive:true,force:true});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=new Map();for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw new Error('Expected --option value');args.set(process.argv[i].slice(2),process.argv[i+1]);}
  const permitted=['profile','output','concurrency','isolates','auth-delay-ms','image-kib','warmups','samples','states'];for(const key of args.keys())if(!permitted.includes(key))throw new Error('Unknown option '+key);
  const options={progress:true};for(const [flag,key] of [['profile','profile'],['concurrency','concurrency'],['isolates','isolates'],['auth-delay-ms','authDelayMs'],['image-kib','imageKiB'],['warmups','warmups'],['samples','samples']])if(args.has(flag))options[key]=flag==='profile'?args.get(flag):Number(args.get(flag));if(args.has('states'))options.states=args.get('states').split(',');
  const report=await runBenchmark(options);const output=resolve(args.get('output')??'.nakwol/reports/bench-local.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');process.stdout.write(output+'\n');
}
