import { readFile, mkdir } from 'node:fs/promises';
const source = await readFile(new URL('./runtime/auth-runtime.mjs', import.meta.url), 'utf8').catch(() => { throw new Error('Run node scripts/build-vercel-auth-test.mjs locally before uploading this directory.'); });
if (!source.includes('handleRequest') || source.length < 1000) throw new Error('AUTH runtime bundle is missing or invalid.');
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
console.log('VERCEL_AUTH_TEST_BUNDLE_READY');
