import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname,join } from 'node:path';
import { callbackStatements,PreparationError } from './vercel-production-plan.mjs';
const args=process.argv.slice(2),opts=new Map();
for(let i=0;i<args.length;i+=2){if(!['--profile','--action','--confirm-database','--receipt'].includes(args[i])||!args[i+1]||opts.has(args[i]))throw new PreparationError('INVALID_ARGUMENTS');opts.set(args[i],args[i+1]);}
const path=opts.get('--profile');if(!path)throw new PreparationError('PROFILE_REQUIRED');
const profile=JSON.parse(await readFile(path,'utf8')),action=opts.get('--action')||'plan';
if(action==='remove'){
 const receiptPath=opts.get('--receipt');if(!receiptPath)throw new PreparationError('CONFIRMED_ADD_RECEIPT_REQUIRED');
 const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
 if(receipt.action!=='add'||receipt.status!=='confirmed'||receipt.databaseId!==profile.databaseId||receipt.origin!==profile.origin||!Array.isArray(receipt.changed))throw new PreparationError('CONFIRMED_ADD_RECEIPT_REQUIRED');
 profile.additions=receipt.changed;
}
const statements=callbackStatements(profile,action==='remove'?'remove':'add');
if(action==='plan'){console.log(JSON.stringify({write:false,additions:profile.additions.length,databaseId:profile.databaseId}));process.exit(0);}
if(!['add','remove'].includes(action)||opts.get('--confirm-database')!==profile.databaseId||Date.now()-Date.parse(profile.checkedAt)>3600000||!Number.isFinite(Date.parse(profile.checkedAt))||Date.parse(profile.checkedAt)>Date.now()+60000)throw new PreparationError('FRESH_PROFILE_AND_EXPLICIT_DB_CONFIRMATION_REQUIRED');
const endpoint=process.env.D1_BRIDGE_URL,secret=process.env.D1_BRIDGE_SECRET;
const url=new URL(endpoint);if(url.protocol!=='https:'||url.pathname!=='/rpc'||url.search||url.hash||url.username||url.password||!secret)throw new PreparationError('SERVER_BRIDGE_CONFIGURATION_REQUIRED');
if(!statements.length){console.log(JSON.stringify({ok:true,changes:0}));process.exit(0);}
const receiptPath=join(dirname(path),'callbacks-'+randomUUID()+'.json');
const receipt={action,status:'uncertain',at:new Date().toISOString(),databaseId:profile.databaseId,origin:profile.origin,planned:profile.additions};
await writeFile(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
let response;
try { response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json','X-Nakwol-Database-ID':profile.databaseId},body:JSON.stringify({method:'batch',statements}),signal:AbortSignal.timeout(10000),redirect:'error'}); }
catch { throw new PreparationError('CALLBACK_WRITE_UNCERTAIN_NO_RETRY_RECEIPT:'+receiptPath); }
if(!response.ok)throw new PreparationError('CALLBACK_WRITE_FAILED_OR_UNCERTAIN_NO_RETRY_RECEIPT:'+receiptPath);
const result=await response.json();if(result.ok!==true||!Array.isArray(result.result)||result.result.length!==statements.length||result.result.some(r=>r.success!==true||![0,1].includes(r.meta?.changes)))throw new PreparationError('CALLBACK_RESULT_UNCERTAIN_NO_RETRY_RECEIPT:'+receiptPath);
receipt.status='confirmed';receipt.changed=profile.additions.filter((_entry,i)=>result.result[i].meta.changes===1);
await writeFile(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});
console.log(JSON.stringify({ok:true,action,changes:receipt.changed.length,receipt:receiptPath}));
