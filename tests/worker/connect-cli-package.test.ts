import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Worker distribution exposes npm CLI package, manifest, and llms discovery', async () => {
  const routes = await readFile(new URL('../../src/connect-cli-distribution.ts', import.meta.url), 'utf8');
  assert.match(routes, /\/connect\/cli\/package\.tgz/);
  assert.match(routes, /\/connect\/cli\/manifest\.json/);
  assert.match(routes, /\/llms\.txt/);
  assert.match(routes, /CONNECT_CLI_PACKAGE_NAME = 'nakwol-connect'/);
  assert.match(routes, /npx --yes nakwol-connect init/);
});

test('npm package metadata is public, executable, and points at the owning repository', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../packages/connect-cli/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'nakwol-connect');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, false);
  assert.equal(pkg.bin?.['nakwol-connect'], 'bin/nakwol-connect.mjs');
  assert.equal(pkg.repository?.url, 'git+https://github.com/goyoung2/nakwol-auth.git');
  assert.equal(pkg.repository?.directory, 'packages/connect-cli');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
});

test('npm publish workflow supports first-token publish and later OIDC trusted publishing', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/publish-npm.yml', import.meta.url), 'utf8');
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /secrets\.NPM_TOKEN/);
  assert.match(workflow, /npm publish \.\/packages\/connect-cli/);
  assert.match(workflow, /FIRST_PUBLISH_REQUIRES_NPM_TOKEN/);
  assert.match(workflow, /\$PKG@\$VERSION/);
  assert.match(workflow, /NAKWOL_CONNECT_NPM_PUBLISH_OK/);
});

test('generated CLI package asset exists and is non-empty base64', async () => {
  const encoded = (await readFile(new URL('../../src/assets/nakwol-connect-cli.tgz.b64.js.txt', import.meta.url), 'utf8')).trim();
  assert.ok(encoded.length > 100);
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
});
