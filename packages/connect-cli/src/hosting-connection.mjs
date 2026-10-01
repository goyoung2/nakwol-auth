import {readFile,writeFile,mkdir,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {parseHosting} from './shared/hosting-schema.mjs';
import {readProjectConfig,writeProjectConfig} from './config.mjs';
import {inspectProtection,createProtectionManifest} from './protection.mjs';
import {boundedBody} from './protection-inventory.mjs';
import {readAutomaticConnection} from './portable-rollout.mjs';
import {verifyProtection} from './protection-verify.mjs';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version;
const workflow='.github/workflows/nakwol-hosting.yml';
const connectionFile='.nakwol/hosting.json';
const notesFile='.nakwol/hosting-connection.md';
async function document(root,file){const bytes=await readFile(resolve(root,file));if(bytes.length>32768)throw new Error('Hosting JSON exceeds 32 KiB.');return parseHosting(JSON.parse(bytes));}
async function preparation(options){
 const root=options.root||process.cwd(),config=await readProjectConfig(root),binding=await document(root,options.hostingFile||connectionFile);
 if(config?.clientId!==binding.clientId||config.authMode!=='required'||config.accessPolicy!=='member'||config.protection?.provider!==binding.provider||config.protection.siteUrl!==binding.siteOrigin+'/')throw new Error('Hosting binding differs from the installed required/member gate.');
 const inspection=await inspectProtection(root,config);if(!inspection.ok)throw new Error(inspection.detail);
 const pkg=JSON.parse(await readFile(join(root,'package.json')));
 if(pkg.workspaces||pkg.packageManager&&!pkg.packageManager.startsWith('npm@'))throw new Error('Hosting templates require a root npm project.');
 if(binding.provider==='cloudflare-workers'||binding.provider==='cloudflare-pages'){
  const wrangler=JSON.parse(await readFile(join(root,'wrangler.nakwol.json')));
  if(wrangler.name!==binding.resourceId)throw new Error('Hosting resource binding differs from wrangler.nakwol.json.');
 }
 if(binding.provider==='vercel'){
  try{const link=JSON.parse(await readFile(join(root,'.vercel/project.json')));if(link.projectId!==binding.resourceId||link.orgId!==binding.teamId)throw new Error('Hosting binding differs from the linked Vercel project.');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(binding.mode==='automatic'){
  // An existing owner-reviewed recovery connection remains the authority. Merely
  // selecting a hosting provider never enables blind deployment or rollback.
  const automatic=await readAutomaticConnection(root,config);
  if(automatic.policy.provider!==binding.provider||automatic.policy.resourceId!==binding.resourceId||automatic.policy.adapterFile!==binding.adapterFile)throw new Error('Reviewed automatic adapter binding does not match hosting JSON.');
 }
 return {root,config,binding,pkg};
}
export async function planHosting(options={}){
 const {binding}=await preparation(options);
 return {ok:true,status:'planned-not-connected',binding,files:[connectionFile,notesFile,workflow],safetyChanges:['Append .nakwol/reports/ to .gitignore without removing existing rules.'],secrets:binding.mode==='automatic'?['NAKWOL_PROBE_SESSION','NAKWOL_RELEASE_STATE_KEY',...(binding.provider==='vercel'?['VERCEL_TOKEN']:['CLOUDFLARE_API_TOKEN'])] : binding.provider==='vercel'?['VERCEL_TOKEN']:['CLOUDFLARE_API_TOKEN'],nextSteps:['Review generated files before committing. The default template checks the existing deployment without changing it.','Run npm install --package-lock-only --ignore-scripts to pin the candidate SDK before CI.','Set hosting Secrets in the production GitHub environment; never put values in hosting JSON.']};
}
async function ensureNew(root,names){
 const base=await realpath(root);
 for(const name of names){let target=resolve(base,name);const rel=relative(base,target);if(isAbsolute(rel)||rel.startsWith('..'))throw new Error('Hosting output escapes project.');
  let first=true;while(target!==base){try{const stat=await lstat(target);if(stat.isSymbolicLink())throw new Error('Hosting output uses a symbolic link.');if(first)throw new Error(`Existing connection must be reviewed manually: ${name}`);if(!stat.isDirectory())throw new Error('Hosting output parent is not a directory.');}catch(error){if(error.code!=='ENOENT')throw error;}first=false;target=dirname(target);}
 }
}
export async function connectHosting(options={}){
 const {root,config,binding,pkg}=await preparation(options);await ensureNew(root,[connectionFile,notesFile,workflow]);
 for(const name of ['package.json','.nakwol-connect.json']){const entry=await lstat(join(root,name));if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Hosting config/package must be regular files without symbolic links.');}
 let ignore='';try{const entry=await lstat(join(root,'.gitignore'));if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Hosting .gitignore must be a regular file.');ignore=await readFile(join(root,'.gitignore'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const dependency=pkg.dependencies?.['nakwol-connect']||pkg.devDependencies?.['nakwol-connect'];
 if(pkg.dependencies?.['nakwol-connect']&&pkg.devDependencies?.['nakwol-connect'])throw new Error('Consolidate the duplicate SDK dependency before connecting hosting.');
 if(dependency&&dependency!==version)throw new Error('Review existing SDK version before installing a hosting connection.');
 const hook=pkg.scripts?.['nakwol:gate'];
 if(hook!=='nakwol-connect protect update'&&!/^npx --yes nakwol-connect@(?:latest|~?\d+\.\d+\.\d+) protect update$/.test(hook||''))throw new Error('Review the custom nakwol:gate hook before connecting hosting.');
 const plan=await planHosting(options);
 const contents=[JSON.stringify(binding,null,2)+'\n',hostingNotes(binding),hostingWorkflow(binding,config)];
 for(const [i,name]of plan.files.entries()){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),contents[i],{flag:'wx'});}
 if(ignore.trimEnd().split('\n').at(-1)!=='.nakwol/reports/')await writeFile(join(root,'.gitignore'),ignore+(ignore&&!ignore.endsWith('\n')?'\n':'')+'.nakwol/reports/\n');
 await writeFile(join(root,'package.json'),JSON.stringify({...pkg,scripts:{...pkg.scripts,'nakwol:gate':'nakwol-connect protect update'},devDependencies:{...pkg.devDependencies,...(!pkg.dependencies?.['nakwol-connect']?{'nakwol-connect':version}:{})}},null,2)+'\n');
 await writeProjectConfig(root,{...config,protection:{...config.protection,updateChannel:'managed',hosting:{schemaVersion:1,file:connectionFile,mode:binding.mode,provider:binding.provider,resourceId:binding.resourceId}}});
 return {...plan,status:'configured-not-deployed',installedPackageVersion:version};
}
function hostingWorkflow(binding,config){
 const automatic=binding.mode==='automatic', dollar=String.fromCharCode(36),expression=name=>`${dollar}{{ ${name} }}`;
 const env=binding.provider==='vercel'?`          VERCEL_TOKEN: ${expression('secrets.VERCEL_TOKEN')}\n`:`          CLOUDFLARE_API_TOKEN: ${expression('secrets.CLOUDFLARE_API_TOKEN')}\n`;
 // No automatic branch expression is used in on.push: GitHub does not evaluate it.
 // Automatic release is dispatched by the owner's serialized deployment workflow.
 return `name: NAKWOL hosting connection\non:\n  workflow_dispatch:\npermissions:\n  contents: read\nconcurrency:\n  group: nakwol-${binding.provider}-${binding.resourceId}\n  cancel-in-progress: false\njobs:\n  verify:\n    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)\n    environment: production\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm run build\n      - run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect update\n      - name: Read provider inventory and verify project binding\n        env:\n${env}        run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting check --json\n      - name: Verify all installed assets on every discovered origin\n        env:\n${env}          NAKWOL_PROBE_SESSION: ${expression('secrets.NAKWOL_PROBE_SESSION')}\n        run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting verify --json\n${automatic?`      # Release is deliberately separate: wire protect hosting release into the\n      # sole owner-controlled deployment job after reviewing the adapter and\n      # restoring a sealed baseline. This verification template never deploys.\n`:''}`;
}
function hostingNotes(binding){
 const provider=binding.provider,command=provider==='vercel'?'vercel link --project '+binding.resourceId+' --scope '+binding.teamId+'\nvercel deploy --prod':provider==='cloudflare-pages'?'wrangler pages deploy <build-directory> --project-name '+binding.resourceId:'wrangler deploy --config wrangler.nakwol.json';
 return `# NAKWOL 호스팅 연결\n\n상태: configured-not-deployed. JSON·워크플로 생성은 운영 적용이 아닙니다.\n\n대상: ${binding.siteOrigin} / ${provider} / ${binding.resourceId}\n모드: ${binding.mode}. 기본 workflow는 실제 배포의 API inventory와 차단을 읽기 전용으로 검사합니다.\n\n## 설치 및 배포\n\n1. package.json 및 lock을 검토·커밋하고 npm ci, npm run build, protect update를 실행하세요.\n2. 호스팅 Secret에 NAKWOL_SESSION_SECRET과 NAKWOL_SITE_CREDENTIAL을 등록하세요. 값은 JSON·Git·브라우저 저장소에 넣지 마세요.\n3. 아래 공식 CLI를 프로젝트의 고정 devDependency로 설치하고 호스팅 배포 설정을 검토하세요. 이 SDK는 호스팅 Secret이나 DB migration을 변경하지 않습니다.\n\n\`\`\`text\n${command}\n\`\`\`\n\n4. GitHub production environment에 ${provider==='vercel'?'VERCEL_TOKEN':'CLOUDFLARE_API_TOKEN'}을 등록하세요. 지정 프로젝트 API 조회 권한만 필요합니다.\n5. 정상 member의 해당 사이트 쿠키를 NAKWOL_PROBE_SESSION Secret으로 별도 등록하면 전체 자산의 인증 허용도 검사합니다. 쿠키가 없으면 anonymous 검사만 통과할 수 있고 릴리스 수락은 false입니다. 만료 시 정상 로그인으로 갱신하세요.\n6. workflow_dispatch는 기본 브랜치만 허용합니다. protect hosting check/verify를 로컬에서도 실행할 수 있습니다.\n\n## 자동 업데이트 연결\n\n호스팅별 Git 자동 배포와 별도 CI를 끄고 모든 변경을 동일 concurrency로 직렬화하세요. 플랫폼 API의 원자적 CAS를 가정하지 않습니다. 대시보드 동시 배포는 자동 운영 조건에 맞지 않습니다.\n자동 모드는 검증된 기존 protection.automatic adapter·baseline·명시적 opt-in이 있어야 설치됩니다. adapter가 없으면 수동 검사 템플릿부터 설치하세요.\nprotect hosting initialize는 현재 배포를 전체 검증한 뒤 AES-GCM baseline을 생성합니다. NAKWOL_RELEASE_STATE_KEY는 무작위 32바이트 hex Secret이며 normal cookie·hosting token과 다릅니다.\nprotect hosting release는 기존 portable rollout의 비교·검사·복구를 사용합니다. 이전 정상 proof 없이 배포하지 않습니다. 실패한 릴리스는 복구 성공 후에도 exit1입니다.\n암호화 baseline만 trusted default branch CI 저장소에서 전달하세요. manifest/report 원문·쿠키는 CI artifact에 공개하지 마세요.\n\n## 우회 주소\n\nAPI 조회 inventory는 차단 증거가 아닙니다. 이전 배포·preview·custom domain까지 verify해야 합니다. 별도 R2/S3·외부 asset 저장소·proxy origin은 API 자동 조회 밖이므로 hosting JSON origins에 직접 추가하고 게이트를 적용하세요.\nWorkers preview_urls:false 및 전체 요청 gate 설정을 유지하세요. 과거 공개 preview나 deployments는 소유자가 확인 후 닫아야 합니다. 실패한 사이트를 자동 삭제하지 않습니다.\n다른 호스팅은 공통 server gate와 portable adapter 계약을 사용하세요. GitHub Pages에 Embed만 붙이는 방식은 데이터 보호가 아닙니다.\n`;
}
export async function checkHosting(options={}){
 const {binding}=await preparation(options),fetchImpl=options.fetchImpl||globalThis.fetch;
 const token=process.env[binding.provider==='vercel'?'VERCEL_TOKEN':'CLOUDFLARE_API_TOKEN'];if(!token)throw new Error('Hosting read-only API credential is missing.');
 const base=binding.provider==='vercel'?'https://api.vercel.com':'https://api.cloudflare.com/client/v4';
 async function api(path){
  const response=await fetchImpl(base+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  const body=await boundedBody(response,1024*1024);if(!response.ok||!body.complete)throw new Error('Hosting inventory API failed.');
  let data;try{data=JSON.parse(body.bytes);}catch{throw new Error('Hosting inventory API returned invalid JSON.');}if(binding.provider!=='vercel'&&(data.success!==true||data.result===undefined))throw new Error('Hosting inventory API rejected the request.');return data;
 }
 const origins=new Set(binding.origins.map(v=>v+'/'));let deploymentId,complete=false,deploymentCount=0;
 const add=value=>{if(!value)throw new Error('Hosting inventory origin is missing.');const url=new URL(value.includes('://')?value:'https://'+value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid hosting inventory origin.');origins.add(url.origin+'/');};
 if(binding.provider==='cloudflare-workers'){
  const account='/accounts/'+binding.accountId,resource=account+'/workers/scripts/'+binding.resourceId;
  const active=(await api(resource+'/deployments')).result.deployments?.[0];
  if(!active?.id||active.versions?.length!==1||active.versions[0].percentage!==100)throw new Error('Worker requires a single 100% serving deployment.');deploymentId=active.id;
  const sub=(await api(resource+'/subdomain')).result;if(sub.previews_enabled!==false)throw new Error('Disable Worker preview URLs before connecting.');
  if(sub.enabled){const domain=(await api(account+'/workers/subdomain')).result.subdomain;add(binding.resourceId+'.'+domain+'.workers.dev');}
  const domainResult=await api(account+'/workers/domains'),domains=domainResult.result;if(!Array.isArray(domains)||domains.length>=100||domainResult.result_info?.total_count>domains.length||domainResult.result_info?.total_pages>1)throw new Error('Worker custom-domain inventory is incomplete.');
  for(const domain of domains)if(domain.service===binding.resourceId)add(domain.hostname);
  // Routes on user-owned zones and external storage cannot be enumerated with
  // account-only credentials. Explicit origins remain the operator's inventory.
  complete=true;
 }else if(binding.provider==='cloudflare-pages'){
  const path='/accounts/'+binding.accountId+'/pages/projects/'+binding.resourceId,project=(await api(path)).result;
  if(project.name!==binding.resourceId||!project.canonical_deployment?.id)throw new Error('Pages project binding is invalid.');deploymentId=project.canonical_deployment.id;add(project.subdomain);for(const domain of project.domains||[])add(domain);
  for(let page=1;page<=20;page++){const data=(await api(path+'/deployments?page='+page+'&per_page=100')).result;if(!Array.isArray(data)||data.length>100)throw new Error('Invalid Pages deployment inventory.');for(const deployment of data){deploymentCount++;add(deployment.url);for(const alias of deployment.aliases||[])add(alias);}if(data.length<100){complete=true;break;}}
 }else{
  const suffix='?teamId='+binding.teamId,project=await api('/v9/projects/'+binding.resourceId+suffix);
  if(project.id!==binding.resourceId||project.accountId!==binding.teamId||!project.targets?.production?.id)throw new Error('Vercel project/team binding is invalid.');deploymentId=project.targets.production.id;
  let until='';for(let page=0;page<20;page++){const data=await api('/v6/deployments'+suffix+'&projectId='+binding.resourceId+'&limit=100'+until);if(!Array.isArray(data.deployments)||data.deployments.length>100)throw new Error('Invalid Vercel inventory.');for(const deployment of data.deployments){if(deployment.projectId&&deployment.projectId!==binding.resourceId)throw new Error('Foreign Vercel deployment.');deploymentCount++;add(deployment.url);}if(!data.pagination?.next){complete=true;break;}if(!Number.isSafeInteger(data.pagination.next))throw new Error('Invalid Vercel pagination.');until='&until='+data.pagination.next;}
  let cursor='';for(let page=0;page<20;page++){const data=await api('/v9/projects/'+binding.resourceId+'/domains'+suffix+'&limit=100'+cursor);if(!Array.isArray(data.domains)||data.domains.length>100)throw new Error('Invalid Vercel domains.');for(const domain of data.domains)add(domain.name);if(!data.pagination?.next){break;}if(page===19)complete=false;cursor='&until='+encodeURIComponent(data.pagination.next);}
  cursor='';for(let page=0;page<20;page++){const data=await api('/v4/aliases'+suffix+'&projectId='+binding.resourceId+'&limit=100'+cursor);if(!Array.isArray(data.aliases)||data.aliases.length>100)throw new Error('Invalid Vercel aliases.');for(const alias of data.aliases){if(alias.projectId&&alias.projectId!==binding.resourceId)throw new Error('Foreign Vercel alias.');add(alias.alias);}if(!data.pagination?.next)break;if(page===19)complete=false;cursor='&until='+encodeURIComponent(data.pagination.next);}
 }
 if(!complete||origins.size>100||!/^[-\w.]{1,200}$/.test(deploymentId))throw new Error('Hosting inventory exceeds the safe verification bound; manual inventory review is required.');
 return {ok:true,status:'inventory-read-not-verified',provider:binding.provider,resourceId:binding.resourceId,deploymentId,origins:[...origins].sort(),inventoryComplete:true,scope:'registered-project-plus-explicit-origins',deploymentCount,limitations:['Zone Worker routes, external storage and other projects require explicit origin registration. No origin is assumed closed and no hosting mutation was performed.']};
}
export async function verifyHosting(options={}){
 const before=await checkHosting(options),root=options.root||process.cwd(),config=await readProjectConfig(root);
 const temporary=await mkdtemp(join(tmpdir(),'nakwol-hosting-proof-'));
 try{
  const cookie=process.env.NAKWOL_PROBE_SESSION,manifest=join(temporary,'manifest.json');
  if(cookie)await createProtectionManifest({root,deploymentId:before.deploymentId,outputFile:manifest});
  const proof=await verifyProtection({root,url:config.protection.siteUrl,alternateOrigins:before.origins.filter(v=>v!==config.protection.siteUrl).join(','),expectRuntime:'installed',...(cookie?{manifest,deploymentId:before.deploymentId,sessionCookieEnv:'NAKWOL_PROBE_SESSION'}:{}),fetchImpl:options.verificationFetchImpl||globalThis.fetch});
  const after=await checkHosting(options),unchanged=before.deploymentId===after.deploymentId&&JSON.stringify(before.origins)===JSON.stringify(after.origins);
  const accepted=unchanged&&proof.releaseAccepted;
  return {...proof,ok:proof.ok&&unchanged&&(!cookie||accepted),releaseAccepted:Boolean(accepted),status:!unchanged?'deployment-conflict':accepted?'hosting-release-verified':cookie?'normal-member-check-failed':'anonymous-checked-without-release-proof',inventory:after};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
