import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function componentVersions(root = resolve('.')) {
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const source = async path => readFile(resolve(root, path), 'utf8');
  const literal = async (path, pattern) => {
    const value = (await source(path)).match(pattern)?.[1];
    if (!value) throw new Error(`VERSION_DECLARATION_MISSING:${path}`);
    return value;
  };
  const auth = (await json('package.json')).version;
  const connect = (await json('packages/connect-cli/package.json')).version;
  const data = (await json('services/data/package.json')).version;
  const sdk = await literal('src/sdk.ts', /NAKWOL_AUTH_WEB_SDK_VERSION = '([^']+)'/);
  const schema = await literal('services/data/src/domain.ts', /DATA_SCHEMA_VERSION = (\d+)/);
  for (const version of [auth, connect, data, sdk]) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('INVALID_COMPONENT_VERSION');
  }
  const checks = [
    ['AUTH health', auth, await literal('src/index.ts', /service: 'nakwol-auth',[\s\S]*?version: '([^']+)'/)],
    ['Connect distribution', connect, await literal('src/connect-cli-distribution.ts', /CONNECT_CLI_VERSION = '([^']+)'/)],
    ['Connect gate', connect, await literal('packages/connect-cli/src/server/gate.mjs', /RUNTIME_VERSION = '([^']+)'/)],
    ['DATA runtime', data, await literal('services/data/src/domain.ts', /DATA_SERVICE_VERSION = '([^']+)'/)],
    ['Web SDK asset', sdk, await literal(`src/assets/nakwol-auth-web-v${sdk}.js.txt`, /NAKWOL_AUTH_SDK_VERSION = '([^']+)'/)],
  ];
  for (const [name, expected, actual] of checks) {
    if (expected !== actual) throw new Error(`VERSION_MISMATCH:${name}:${expected}:${actual}`);
  }
  return { auth, connect, data, sdk, schema: Number(schema) };
}

export function versionTable(v) {
  return `<!-- component-versions:start -->\n| 구성 요소 | 이 브랜치의 소스 버전 |\n|---|---:|\n| AUTH | ${v.auth} |\n| Connect CLI·공통 게이트 | ${v.connect} |\n| Web SDK | ${v.sdk} |\n| DATA | ${v.data} |\n| DATA 스키마 | ${v.schema} |\n<!-- component-versions:end -->`;
}

export async function verifyVersions({ root = resolve('.'), write = false } = {}) {
  const versions = await componentVersions(root);
  const path = resolve(root, 'README.md');
  const readme = await readFile(path, 'utf8');
  const pattern = /<!-- component-versions:start -->[\s\S]*?<!-- component-versions:end -->/;
  const expected = versionTable(versions);
  const actual = readme.match(pattern)?.[0].replaceAll('\r\n', '\n');
  if (write) {
    if (!actual) throw new Error('VERSION_TABLE_MARKERS_REQUIRED');
    await writeFile(path, readme.replace(pattern, expected));
  } else if (actual !== expected) {
    throw new Error('README_VERSION_TABLE_STALE:run npm run versions:sync');
  }
  return versions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--write')) throw new Error('UNKNOWN_VERSION_ARGUMENT');
  console.log(JSON.stringify(await verifyVersions({ write: args.includes('--write') })));
}
