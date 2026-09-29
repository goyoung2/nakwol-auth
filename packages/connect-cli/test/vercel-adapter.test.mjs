import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installProtection, inspectProtection, updateProtection, createProtectionManifest } from '../src/protection.mjs';
import { readProtectionManifest } from '../src/protection-inventory.mjs';
import { writeProjectConfig, readProjectConfig } from '../src/config.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-vercel-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  await mkdir(join(root,'dist'));
  for (const file of ['index.html','dist/index.html']) await writeFile(join(root,file), '<html><body>PRIVATE</body></html>');
  await writeProjectConfig(root, {clientId:'test-site',authOrigin:'https://auth.test/',framework:'html',redirectUris:['https://site.test/'],authMode:'required'});
  return root;
}
const options = root => ({root,provider:'vercel',assets:'dist',url:'https://site.test/'});

test('Vercel static installation uses shared gate, all paths and inspectable update', async t => {
  const root = await fixture(t);
  const installed = await installProtection(options(root));
  assert.equal(installed.protection.schemaVersion,1);
  assert.ok(installed.protection.capabilities.includes('all-paths'));
  assert.equal(installed.protection.authOrigin,'https://auth.test');
  const middleware = await readFile(join(root,'middleware.js'),'utf8');
  assert.match(middleware,/createGate/);
  assert.match(middleware,/matcher: \['\/:path\*'\]/);
  const config = JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));
  assert.equal(config.outputDirectory,'dist');
  assert.equal(config.headers,undefined);
  assert.equal((await inspectProtection(root,await readProjectConfig(root))).ok,true);
  assert.equal((await updateProtection({root})).ok,true);
  await writeFile(join(root,'middleware.js'),middleware+'// changed');
  await assert.rejects(updateProtection({root}),/변경/);
});

for (const file of ['vercel.json','middleware.ts','src/middleware.js','proxy.ts','api/private.js']) {
  test(`Vercel refuses existing routing/server file ${file}`, async t => {
    const root=await fixture(t);
    if(file.includes('/')) await mkdir(join(root,file.split('/')[0]));
    await writeFile(join(root,file),'{}');
    await assert.rejects(installProtection(options(root)),/기존|정적/);
    assert.equal(await readFile(join(root,file),'utf8'),'{}');
  });
}

test('Next dependency cannot masquerade as plain static HTML', async t => {
  const root=await fixture(t);
  await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{next:'15.0.0'}}));
  await assert.rejects(installProtection(options(root)),/정적/);
});

test('manifest command emits reproducible bound inventory outside public output', async t => {
  const root=await fixture(t);
  await installProtection(options(root));
  const result=await createProtectionManifest({root,deploymentId:'fixture-deploy',outputFile:'manifest.json'});
  const manifest=await readProtectionManifest(join(root,'manifest.json'),{deploymentId:'fixture-deploy'});
  assert.equal(result.buildHash,manifest.buildHash);
  assert.deepEqual(manifest.files.map(f=>f.path),['/index.html']);
  await assert.rejects(createProtectionManifest({root,deploymentId:'fixture-deploy',outputFile:'dist/evidence.json'}),/공개/);
  await assert.rejects(createProtectionManifest({root,deploymentId:'fixture-deploy',outputFile:'manifest.json'}),/EEXIST/);
});
