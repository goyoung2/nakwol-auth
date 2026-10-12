import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import { inspectRelease } from '../../scripts/check-npm-release.mjs';
import { packageContent } from '../../scripts/package-content.mjs';

async function archives(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nakwol-artifact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package')); await writeFile(join(dir, 'package/index.js'), 'export const value=1;\n');
  const pack = async gzip => {
    const chunks = [];
    for await (const chunk of create({ cwd: dir, gzip, portable: true }, ['package/index.js'])) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const local = await pack(false), remote = await pack(true);
  await writeFile(join(dir, 'package/index.js'), 'export const value=2;\n');
  return { local, remote, changed: await pack(true) };
}
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
async function check(local, remote, declared = sri(remote)) {
  const repository = { url: 'git+https://github.com/goyoung2/nakwol-auth.git' };
  const entry = { name: 'nakwol-connect', version: '0.7.2', repository,
    dist: { integrity: declared, tarball: 'https://registry.npmjs.org/nakwol-connect/-/nakwol-connect-0.7.2.tgz' } };
  return inspectRelease({ name: entry.name, version: entry.version, integrity: sri(local), artifact: local,
    fetchImpl: async url => url.endsWith('.tgz') ? new Response(remote) : Response.json({ name: entry.name, repository, versions: { '0.7.2': entry } }) });
}
test('archive container changes preserve exact file content identity', async t => {
  const { local, remote } = await archives(t);
  assert.notEqual(sri(local), sri(remote));
  assert.deepEqual(await check(local, remote), { packageExists: true, published: true });
});
test('same version with changed source bytes fails even with valid registry integrity', async t => {
  const { local, changed } = await archives(t);
  await assert.rejects(check(local, changed), /CONTENT_MISMATCH/);
});
test('registry artifact integrity is checked before content comparison', async t => {
  const { local, remote, changed } = await archives(t);
  await assert.rejects(check(local, changed, sri(remote)), /INTEGRITY_FAILED/);
});
test('invalid archive never compares as an empty package', async () => {
  await assert.rejects(packageContent(Buffer.from('invalid tar')));
});
test('Windows text checkout endings compare without hiding code changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nakwol-endings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'package'));
  const pack = async bytes => {
    await writeFile(join(dir, 'package/index.js'), bytes);
    const chunks = [];
    for await (const chunk of create({ cwd: dir, gzip: true }, ['package/index.js'])) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const lf = await pack('export const a=1;\nexport const b=2;\n');
  const crlf = await pack('export const a=1;\r\nexport const b=2;\r\n');
  assert.equal(await packageContent(lf), await packageContent(crlf));
  const invalidA = await pack(Buffer.from([0xff]));
  const invalidB = await pack(Buffer.from([0xfe]));
  assert.notEqual(await packageContent(invalidA), await packageContent(invalidB));
});
