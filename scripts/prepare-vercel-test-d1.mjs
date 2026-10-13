import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, dirname } from 'node:path';
const args = process.argv.slice(2), options = new Map();
for (let i=0;i<args.length;i+=2) {
  if (!['--database-name','--database-id','--auth-origin'].includes(args[i]) || !args[i+1]) throw new Error('Required: --database-name TEST_NAME --database-id TEST_UUID --auth-origin TEST_ORIGIN');
  options.set(args[i],args[i+1]);
}
const name=options.get('--database-name'), id=options.get('--database-id'), origin=options.get('--auth-origin');
if (!name || !/^nakwol-auth-vercel-test(?:-[a-z0-9-]+)?$/.test(name) || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id==='00000000-0000-0000-0000-000000000000' || origin!=='https://nakwol-auth-vercel-test.vercel.app') throw new Error('A separate explicitly named canary database and exact test AUTH origin are required.');
const root=fileURLToPath(new URL('..',import.meta.url)), out=resolve(root,'.wrangler/vercel-test');
await mkdir(out,{recursive:true});
const configPath=resolve(out,'generated-bridge.wrangler.jsonc');
const portable=path=>relative(dirname(configPath),path).split(String.fromCharCode(92)).join('/');
await writeFile(configPath,JSON.stringify({name:'nakwol-auth-vercel-test-d1-bridge',main:portable(resolve(root,'deploy/vercel-auth-test/bridge-worker.mjs')),compatibility_date:'2026-10-09',vars:{NAKWOL_D1_TEST_BRIDGE:'true'},d1_databases:[{binding:'DB',database_name:name,database_id:id,migrations_dir:portable(resolve(root,'migrations'))}]},null,2)+String.fromCharCode(10));
const template=await readFile(resolve(root,'deploy/vercel-auth-test/bootstrap.sql.template'),'utf8');
await writeFile(resolve(out,'bootstrap.sql'),template.replaceAll('__AUTH_ORIGIN__',origin));
console.log('CANARY_D1_CONFIG_READY');
