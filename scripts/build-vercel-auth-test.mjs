import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const packed = spawnSync(process.execPath, ['scripts/build-connect-cli-package.mjs'], { cwd: root, stdio: 'inherit' });
if (packed.status !== 0) throw new Error('CONNECT CLI package generation failed.');
await build({ absWorkingDir: root, entryPoints: ['adapters/vercel/entry.ts'], outfile: 'deploy/vercel-auth-test/runtime/auth-runtime.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm', loader: { '.txt': 'text' }, legalComments: 'none' });
await build({ absWorkingDir: root, entryPoints: ['adapters/vercel/bridge-worker.ts'], outfile: 'deploy/vercel-auth-test/bridge-worker.mjs', bundle: true, platform: 'browser', target: 'es2022', format: 'esm' });
console.log('VERCEL_AUTH_TEST_LOCAL_BUNDLES_READY');
