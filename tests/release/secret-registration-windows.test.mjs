import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('Windows secret registration preserves exact stdin and accepts native stderr banners while checking failures',{skip:process.platform!=='win32'},()=>{
 const root=mkdtempSync(join(tmpdir(),'nakwol-secret-fixture-'));
 assert.equal(dirname(resolve(root)),resolve(tmpdir()));
 const run=(cmd,args,env={})=>spawnSync(cmd,args,{cwd:root,encoding:'utf8',env:{...process.env,...env},timeout:30000});
 try{
  for(const name of ['scripts','deploy/vercel-auth-production/.vercel','profile','bin'])mkdirSync(join(root,name),{recursive:true});
  assert.equal(run('git',['init','--initial-branch=stable']).status,0);
  writeFileSync(join(root,'scripts/register-production-discord-secret.ps1'),readFileSync('scripts/register-production-discord-secret.ps1'));
  writeFileSync(join(root,'scripts/register-production-secret.mjs'),readFileSync('scripts/register-production-secret.mjs'));
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
  writeFileSync(join(root,'deploy/vercel-auth-production/.vercel/project.json'),JSON.stringify({projectId:'fixture-project',orgId:'fixture-team'}));
  writeFileSync(join(root,'profile/profile.json'),JSON.stringify({databaseName:'nakwol-auth',worker:'nakwol-auth',databaseId:'fixture-database',accountId:'fixture-account',vercelProjectName:'nakwol-auth-vercel',vercelProjectId:'fixture-project',vercelTeamId:'fixture-team',missingSchema:[],checkedAt:new Date().toISOString()}));
  writeFileSync(join(root,'profile/readonly.wrangler.json'),JSON.stringify({account_id:'fixture-account',name:'nakwol-auth',d1_databases:[{binding:'DB',database_name:'nakwol-auth',database_id:'fixture-database'}]}));
  const cli=`import {writeFileSync} from 'node:fs';let input='';for await(const part of process.stdin)input+=part;const kind=process.env.NAKWOL_FIXTURE_COMMAND;writeFileSync(process.env.NAKWOL_FIXTURE_ROOT+'/'+kind+'.json',JSON.stringify({exact:input.trimEnd()==='fixture-only-never-a-real-secret',bom:input.codePointAt(0)===65279}));process.stderr.write('Normal CLI banner'+String.fromCharCode(10));process.exit(Number(process.env['NAKWOL_FIXTURE_'+kind+'_EXIT']||0));`;
  writeFileSync(join(root,'bin/wrangler.mjs'),cli.replace("process.env.NAKWOL_FIXTURE_COMMAND","'CF'"));
  writeFileSync(join(root,'bin/vercel.mjs'),cli.replace("process.env.NAKWOL_FIXTURE_COMMAND","'VC'"));
  writeFileSync(join(root,'bin/npx.cmd'),'@echo off\r\nnode "%~dp0vercel.mjs" %*\r\n');
  writeFileSync(join(root,'harness.ps1'),`$ErrorActionPreference='Stop'
function global:Read-Host { param($Prompt,[switch]$AsSecureString) ConvertTo-SecureString 'fixture-only-never-a-real-secret' -AsPlainText -Force }\n$OutputEncoding=New-Object System.Text.UTF8Encoding($true)\n& "$PSScriptRoot/scripts/register-production-discord-secret.ps1" -Profile "$PSScriptRoot/profile/profile.json" -Wrangler "$PSScriptRoot/bin/wrangler.mjs"\n`);
  const env={PSModulePath:join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/Modules'),PATH:join(root,'bin')+';'+process.env.PATH,NAKWOL_FIXTURE_ROOT:root};
  const success=run('powershell.exe',['-NoProfile','-File','harness.ps1'],env);
  assert.equal(success.status,0,(success.stdout+success.stderr).slice(0,2000));
  for(const name of ['CF','VC'])assert.deepEqual(JSON.parse(readFileSync(join(root,name+'.json'),'utf8')),{exact:true,bom:false});
  for(const name of ['CF','VC']){
   if(name==='CF')rmSync(join(root,'VC.json'));
   const failed=run('powershell.exe',['-NoProfile','-File','harness.ps1'],{...env,['NAKWOL_FIXTURE_'+name+'_EXIT']:'7'});
   assert.notEqual(failed.status,0);
   if(name==='CF')assert.equal(existsSync(join(root,'VC.json')),false);
   assert.ok(!(failed.stdout+failed.stderr).includes('fixture-only-never-a-real-secret'));
  }
  for(const name of ['CF','VC'])if(existsSync(join(root,name+'.json')))rmSync(join(root,name+'.json'));
  writeFileSync(join(root,'profile/bridge.wrangler.jsonc'),JSON.stringify({name:'nakwol-auth',account_id:'fixture-account',vars:{NAKWOL_D1_BRIDGE_MODE:'production',NAKWOL_D1_BRIDGE_DATABASE_ID:'fixture-database'},d1_databases:[{binding:'DB',database_name:'nakwol-auth',database_id:'fixture-database'}]}));
  const wrongBridge=run(process.execPath,['scripts/register-production-secret.mjs','--profile','profile/profile.json','--wrangler','bin/wrangler.mjs','--secret-name','D1_BRIDGE_SECRET'],env);
  assert.notEqual(wrongBridge.status,0);assert.match(wrongBridge.stderr,/ACTUAL_WORKER_SECRET_TARGET_MISMATCH/);for(const name of ['CF','VC'])assert.equal(existsSync(join(root,name+'.json')),false);
  const bridge=JSON.parse(readFileSync(join(root,'profile/bridge.wrangler.jsonc'),'utf8'));bridge.name='nakwol-auth-vercel-db';writeFileSync(join(root,'profile/bridge.wrangler.jsonc'),JSON.stringify(bridge));
  const validBridge=spawnSync(process.execPath,['scripts/register-production-secret.mjs','--profile','profile/profile.json','--wrangler',join(root,'bin/wrangler.mjs'),'--secret-name','D1_BRIDGE_SECRET'],{cwd:root,encoding:'utf8',env:{...process.env,...env},input:'fixture-only-never-a-real-secret',timeout:30000});
  assert.equal(validBridge.status,0,(validBridge.stdout+validBridge.stderr).slice(0,1000));for(const name of ['CF','VC'])assert.deepEqual(JSON.parse(readFileSync(join(root,name+'.json'),'utf8')),{exact:true,bom:false});
 }finally{assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
});
