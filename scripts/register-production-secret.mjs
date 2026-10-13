import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),options=new Map();
for(let i=0;i<args.length;i+=2){if(!['--profile','--wrangler','--secret-name'].includes(args[i])||!args[i+1]||options.has(args[i]))throw Error('INVALID_SECRET_REGISTRATION_ARGUMENTS');options.set(args[i],args[i+1]);}
const profilePath=options.get('--profile'),wrangler=options.get('--wrangler'),name=options.get('--secret-name');
if(!profilePath||!wrangler||!['DISCORD_CLIENT_SECRET','D1_BRIDGE_SECRET'].includes(name))throw Error('EXPLICIT_SECRET_TARGET_REQUIRED');
const profile=JSON.parse(readFileSync(profilePath,'utf8')),upload=resolve(root,'deploy/vercel-auth-production');
const project=JSON.parse(readFileSync(upload+'/.vercel/project.json','utf8'));
const config=JSON.parse(readFileSync(resolve(dirname(profilePath),'readonly.wrangler.json'),'utf8'));
if(execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim()!=='stable'||profile.worker!=='nakwol-auth'||profile.databaseName!=='nakwol-auth'||project.projectId!==profile.vercelProjectId||project.orgId!==profile.vercelTeamId||config.account_id!==profile.accountId||config.d1_databases[0].database_id!==profile.databaseId||!/^[A-Za-z0-9_-]+$/.test(profile.vercelTeamId))throw Error('PRODUCTION_SECRET_TARGET_MISMATCH');
if(!Number.isFinite(Date.parse(profile.checkedAt))||Date.now()-Date.parse(profile.checkedAt)>3600000||Date.parse(profile.checkedAt)>Date.now()+60000||profile.missingSchema.length)throw Error('FRESH_READY_PROFILE_REQUIRED');
const workerConfig=resolve(dirname(profilePath),name==='D1_BRIDGE_SECRET'?'bridge.wrangler.jsonc':'readonly.wrangler.json');
const actualConfig=JSON.parse(readFileSync(workerConfig,'utf8'));const binding=actualConfig.d1_databases?.find(v=>v.binding==='DB');
if(actualConfig.name!==(name==='D1_BRIDGE_SECRET'?'nakwol-auth-vercel-db':'nakwol-auth')||actualConfig.account_id!==profile.accountId||binding?.database_id!==profile.databaseId||binding.database_name!==profile.databaseName||name==='D1_BRIDGE_SECRET'&&(actualConfig.vars?.NAKWOL_D1_BRIDGE_MODE!=='production'||actualConfig.vars?.NAKWOL_D1_BRIDGE_DATABASE_ID!==profile.databaseId||actualConfig.vars?.NAKWOL_D1_TEST_BRIDGE==='true'))throw Error('ACTUAL_WORKER_SECRET_TARGET_MISMATCH');
let input='';for await(const part of process.stdin)input+=part;
const secret=input.trim();input='';
if(!secret||secret.includes('\n')||secret.includes('\r'))throw Error('INVALID_SECRET_INPUT');

const cf=spawnSync(process.execPath,[wrangler,'secret','put',name,'--config',workerConfig],{cwd:root,input:secret,encoding:'utf8',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:profile.accountId},timeout:60000,maxBuffer:1048576});
if(cf.status!==0)throw Error('CLOUDFLARE_SECRET_REGISTRATION_FAILED_NO_VERCEL_WRITE');
// Only fixed flags, an allowlisted name and a validated team ID reach the Windows command shell.
const vc=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--yes','vercel','env','add',name,'production','--force','--sensitive','--yes','--scope',profile.vercelTeamId],{cwd:upload,input:secret,encoding:'utf8',shell:process.platform==='win32',timeout:60000,maxBuffer:1048576});
if(vc.status!==0)throw Error('VERCEL_SECRET_REGISTRATION_FAILED_KEEP_NEW_CLOUDFLARE_SECRET_AND_RETRY_SAME_VALUE');
console.log('Both Secret stores updated. Redeploy Vercel and verify real login before switching services.');
