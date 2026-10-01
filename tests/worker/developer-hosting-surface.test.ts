import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

test('the actually served setup browser module parses before any API or OAuth call',async()=>{
 const source=await readFile('src/assets/nakwol-developer-setup.js.txt','utf8');
 const parsed=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8',timeout:10000});
 assert.equal(parsed.status,0,parsed.stderr);
});
test('the built AUTH surface publishes the exact portable hosting validator',async()=>{
 const bundled=await build({entryPoints:['src/sdk-entry.ts'],bundle:true,write:false,format:'esm',platform:'node',loader:{'.txt':'text'}});
 const module=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const response=await module.default.fetch(new Request('https://auth.test/presentation/v1/hosting-schema.mjs'),{});
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')||'',/javascript/);
 assert.equal(await response.text(),await readFile('packages/connect-cli/src/shared/hosting-schema.mjs','utf8'));
});
