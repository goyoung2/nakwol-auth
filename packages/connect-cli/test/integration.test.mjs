import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProject } from '../src/project.mjs';
import { installIntegration, removeIntegration } from '../src/integration.mjs';

async function make(rootFiles, pkg = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-connect-install-'));
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  for (const [path, content] of Object.entries(rootFiles)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('installs universal embed once and removes only its marker block', async () => {
  const root = await make({ 'index.html': '<html><body><main>keep</main></body></html>' }, { dependencies: { vite: '^7' } });
  try {
    const project = await detectProject(root);
    await installIntegration(root, project, 'battle-map');
    await installIntegration(root, project, 'battle-map');
    const installed = await readFile(join(root, 'index.html'), 'utf8');
    assert.equal((installed.match(/NAKWOL-CONNECT:START/g) || []).length, 1);
    assert.match(installed, /data-client-id="battle-map"/);
    assert.doesNotMatch(installed, /data-redirect-uri/);
    await removeIntegration(root, project);
    const removed = await readFile(join(root, 'index.html'), 'utf8');
    assert.match(removed, /<main>keep<\/main>/);
    assert.doesNotMatch(removed, /NAKWOL-CONNECT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installs Next.js Script in App Router layout idempotently', async () => {
  const root = await make({ 'app/layout.tsx': `export default function Layout({children}){return <html><body>{children}</body></html>}` }, { dependencies: { next: '^16', react: '^19' } });
  try {
    const project = await detectProject(root);
    await installIntegration(root, project, 'battle-map');
    await installIntegration(root, project, 'battle-map');
    const installed = await readFile(join(root, 'app/layout.tsx'), 'utf8');
    assert.equal((installed.match(/NAKWOL-CONNECT:START/g) || []).length, 1);
    assert.match(installed, /from 'next\/script'/);
    assert.match(installed, /data-client-id="battle-map"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
