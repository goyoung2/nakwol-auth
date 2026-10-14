import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { componentVersions, verifyVersions } from '../../scripts/verify-component-versions.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['package.json', 'packages/connect-cli/package.json', 'services/data/package.json', 'src/index.ts',
    'src/connect-cli-distribution.ts', 'packages/connect-cli/src/server/gate.mjs', 'src/sdk.ts',
    'services/data/src/domain.ts', 'src/assets/nakwol-auth-web-v0.3.4.js.txt', 'README.md']) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), await readFile(resolve(path)));
  }
  return root;
}
test('current component versions align without treating source as deployment', async () => {
  const v = await verifyVersions(); assert.equal(v.connect, '0.7.7'); assert.equal(v.schema, 4);
});
test('package bump without gate/distribution bump is blocked', async t => {
  const root = await fixture(t), path = join(root, 'packages/connect-cli/package.json');
  const pkg = JSON.parse(await readFile(path)); pkg.version = pkg.version.replace(/(\d+)$/, value => String(Number(value) + 1)); await writeFile(path, JSON.stringify(pkg));
  await assert.rejects(componentVersions(root), /VERSION_MISMATCH/);
});
test('stale machine version table fails, sync repairs it', async t => {
  const root = await fixture(t), path = join(root, 'README.md');
  await writeFile(path, (await readFile(path, 'utf8')).replace('| DATA 스키마 | 4 |', '| DATA 스키마 | 3 |'));
  await assert.rejects(verifyVersions({ root }), /TABLE_STALE/);
  await verifyVersions({ root, write: true }); await verifyVersions({ root });
});
