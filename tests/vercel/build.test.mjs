import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Vercel requires nonempty static output even when AUTH uses only a Function.
test('standalone build publishes only robots.txt and keeps AUTH/SQL helpers outside output', async()=>{
  const deployment = new URL('../../deploy/vercel-auth-test/',import.meta.url);
  const staged = await mkdtemp(join(tmpdir(),'nakwol-vercel-build-'));
  try {
    await mkdir(join(staged,'runtime'));
    for(const name of ['package.json','build.mjs','runtime/auth-runtime.mjs']) await copyFile(new URL(name,deployment),join(staged,name));
    const built=spawnSync(process.execPath,['build.mjs'],{cwd:staged,encoding:'utf8'});
    assert.equal(built.status,0,built.stderr);
    assert.deepEqual(await readdir(join(staged,'public')),['robots.txt']);
    const lines=(await readFile(join(staged,'public','robots.txt'),'utf8')).trim().split(String.fromCharCode(10));
    assert.deepEqual(lines,['User-agent: *','Disallow: /']);
  } finally { await rm(staged,{recursive:true,force:true}); }
});
