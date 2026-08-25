import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProject } from '../src/project.mjs';

async function fixture(pkg = {}, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-connect-'));
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

test('detects React + Vite and root index.html', async () => {
  const root = await fixture({ dependencies: { react: '^19', vite: '^7' } }, { 'index.html': '<body></body>' });
  try {
    const result = await detectProject(root);
    assert.equal(result.framework, 'react');
    assert.equal(result.targetFile, 'index.html');
    assert.equal(result.defaultRedirectUri, 'http://localhost:5173/');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('detects Next.js App Router global layout', async () => {
  const root = await fixture({ dependencies: { next: '^16', react: '^19' } }, { 'app/layout.tsx': 'export default function Layout({children}){return <html><body>{children}</body></html>}' });
  try {
    const result = await detectProject(root);
    assert.equal(result.framework, 'next_app');
    assert.equal(result.targetFile, 'app/layout.tsx');
    assert.equal(result.defaultRedirectUri, 'http://localhost:3000/');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('detects SvelteKit app.html', async () => {
  const root = await fixture({ devDependencies: { '@sveltejs/kit': '^3' } }, { 'src/app.html': '<body>%sveltekit.body%</body>' });
  try {
    const result = await detectProject(root);
    assert.equal(result.framework, 'sveltekit');
    assert.equal(result.targetFile, 'src/app.html');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('detects static HTML', async () => {
  const root = await fixture({}, { 'index.html': '<body></body>' });
  try {
    const result = await detectProject(root);
    assert.equal(result.framework, 'html');
    assert.equal(result.targetFile, 'index.html');
  } finally { await rm(root, { recursive: true, force: true }); }
});
