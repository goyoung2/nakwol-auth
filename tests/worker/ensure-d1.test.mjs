import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

async function run(existing,flags){
 const root=await mkdtemp(join(tmpdir(),'nakwol-existing-db-'));
 try{
  const before=JSON.stringify({name:'nakwol-auth',d1_databases:[]});
  await writeFile(join(root,'wrangler.jsonc'),before);
  const loader=join(root,'provider.mjs');
  await writeFile(loader,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import fs from 'node:fs';let found=${existing};cp.execFileSync=(command,args)=>{fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');if(args.join(' ')==='wrangler d1 list --json')return JSON.stringify(found?[{name:'nakwol-auth',uuid:'11111111-1111-4111-8111-111111111111'}]:[]);if(args.join(' ')==='wrangler d1 create nakwol-auth --location apac'){found=true;return '';}throw Error('Unexpected provider mutation');};syncBuiltinESMExports();`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(loader).href,resolve('scripts/ensure-d1.mjs'),...flags],{cwd:root,encoding:'utf8'});
  return {status:result.status,stderr:result.stderr,calls:(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),config:await readFile(join(root,'wrangler.jsonc'),'utf8'),before};
 }finally{await rm(root,{recursive:true,force:true});}
}
test('existing-only preflight refuses absent database without remote creation or local config change',async()=>{
 const r=await run(false,['--existing-only']);assert.notEqual(r.status,0);assert.match(r.stderr,/existing production D1/);assert.deepEqual(r.calls,[['wrangler','d1','list','--json']]);assert.equal(r.config,r.before);
});
test('existing-only resolves the real existing binding without creating remote resources',async()=>{
 const r=await run(true,['--existing-only']);assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[['wrangler','d1','list','--json']]);assert.equal(JSON.parse(r.config).d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
});
test('explicit deployment bootstrap retains its previous create behavior',async()=>{
 const r=await run(false,[]);assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[['wrangler','d1','list','--json'],['wrangler','d1','create','nakwol-auth','--location','apac'],['wrangler','d1','list','--json']]);
});
