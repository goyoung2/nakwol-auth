import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageContent } from './package-content.mjs';

const registry = 'https://registry.npmjs.org';
const repository = 'https://github.com/goyoung2/nakwol-auth';
const normalizeRepo = value => typeof value === 'string' ? value.replace(/^git\+/, '').replace(/\.git\/?$/, '').replace(/\/$/, '') : '';

export async function inspectRelease({ name, version, integrity, artifact, fetchImpl = fetch }) {
  if (name !== 'nakwol-connect' || !/^\d+\.\d+\.\d+$/.test(version) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
    throw new Error('INVALID_RELEASE_METADATA');
  }
  const response = await fetchImpl(`${registry}/${name}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return { packageExists: false, published: false };
  if (!response.ok) throw new Error(`REGISTRY_LOOKUP_FAILED:${response.status}`);
  const doc = await response.json();
  if (doc?.name !== name || normalizeRepo(doc.repository?.url) !== repository || !doc.versions || typeof doc.versions !== 'object' || Array.isArray(doc.versions)) {
    throw new Error('REGISTRY_PACKAGE_METADATA_INVALID');
  }
  const published = doc.versions[version];
  if (!published) {
    const latest = doc['dist-tags']?.latest;
    if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('REGISTRY_LATEST_INVALID');
    const candidate = version.split('.').map(Number);
    const previous = latest.split('.').map(Number);
    const firstDifference = candidate.findIndex((value, index) => value !== previous[index]);
    if (firstDifference < 0 || candidate[firstDifference] < previous[firstDifference]) throw new Error('RELEASE_WOULD_DOWNGRADE_LATEST');
    return { packageExists: true, published: false };
  }
  if (published.name !== name || published.version !== version || normalizeRepo(published.repository?.url) !== repository
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(published.dist?.integrity || '') || published.dist?.tarball !== `${registry}/${name}/-/${name}-${version}.tgz`) {
    throw new Error('PUBLISHED_VERSION_CONTENT_MISMATCH:use a new version');
  }
  if (published.dist.integrity !== integrity) {
    if (!artifact) throw new Error('PUBLISHED_VERSION_CONTENT_MISMATCH:local artifact required');
    const tarball = await fetchImpl(published.dist.tarball, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!tarball.ok) throw new Error('REGISTRY_TARBALL_LOOKUP_FAILED:' + tarball.status);
    if (Number(tarball.headers.get('Content-Length')) > 8 * 1024 * 1024) throw new Error('PACKAGE_ARCHIVE_TOO_LARGE');
    const chunks = []; let length = 0;
    if (!tarball.body) throw new Error('REGISTRY_TARBALL_EMPTY');
    for await (const chunk of tarball.body) {
      length += chunk.length;
      if (length > 8 * 1024 * 1024) throw new Error('PACKAGE_ARCHIVE_TOO_LARGE');
      chunks.push(chunk);
    }
    const remote = Buffer.concat(chunks);
    if ('sha512-' + createHash('sha512').update(remote).digest('base64') !== published.dist.integrity) throw new Error('REGISTRY_TARBALL_INTEGRITY_FAILED');
    if (await packageContent(artifact) !== await packageContent(remote)) throw new Error('PUBLISHED_VERSION_CONTENT_MISMATCH:use a new version');
  }
  return { packageExists: true, published: true };
}

export async function waitForRelease({ inspect, attempts = 24, sleep = ms => new Promise(done => setTimeout(done, ms)) }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const state = await inspect();
    if (state.published) return state;
    if (attempt < attempts) await sleep(5000);
  }
  throw new Error('REGISTRY_PUBLICATION_NOT_VISIBLE');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--verify')) throw new Error('UNKNOWN_RELEASE_ARGUMENT');
  const pkg = JSON.parse(await readFile('packages/connect-cli/package.json', 'utf8'));
  const bytes = Buffer.from((await readFile('src/assets/nakwol-connect-cli.tgz.b64.js.txt', 'utf8')).trim(), 'base64');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  const inspect = () => inspectRelease({ name: pkg.name, version: pkg.version, integrity, artifact: bytes });
  const state = args.includes('--verify') ? await waitForRelease({ inspect }) : await inspect();
  if (process.env.GITHUB_ENV && !args.includes('--verify')) {
    await appendFile(process.env.GITHUB_ENV, `PACKAGE_NAME=${pkg.name}\nPACKAGE_VERSION=${pkg.version}\nPACKAGE_EXISTS=${state.packageExists}\nALREADY_PUBLISHED=${state.published}\n`);
  }
  console.log(JSON.stringify({ name: pkg.name, version: pkg.version, integrity, ...state }));
}
