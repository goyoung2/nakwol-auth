import { readFile, mkdir, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
if (Object.values(manifest.dependencies || {}).some(value => /^(?:file:|link:|workspace:|\.\.?\/)/.test(value))) throw new Error('Deployment dependencies must be registry packages inside the standalone upload.');
const source = await readFile(new URL('./runtime/auth-runtime.mjs', import.meta.url), 'utf8').catch(() => { throw new Error('Run node scripts/build-vercel-auth-test.mjs locally before uploading this directory.'); });
if (!source.includes('handleRequest') || source.length < 1000) throw new Error('AUTH runtime bundle is missing or invalid.');
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
await writeFile(new URL('./public/robots.txt', import.meta.url), ['User-agent: *', 'Disallow: /', ''].join(String.fromCharCode(10)));
console.log('VERCEL_AUTH_TEST_BUNDLE_READY');
