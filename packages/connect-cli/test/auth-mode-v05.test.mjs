import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProject } from '../src/project.mjs';
import { installIntegration, inspectIntegration } from '../src/integration.mjs';
import { readProjectConfig, writeProjectConfig } from '../src/config.mjs';

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-auth-mode-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name:'auth-mode-test', dependencies:{ vite:'^7' } }));
  await writeFile(join(root, 'index.html'), '<html><body><main>app</main></body></html>');
  return root;
}

test('Connect integration is required by default and optional only when explicit', async () => {
  const root = await makeProject();
  try {
    const project = await detectProject(root);
    await installIntegration(root, project, 'auth-mode-test');
    let html = await readFile(join(root, 'index.html'), 'utf8');
    assert.match(html, /data-auth="required"/);
    assert.equal((await inspectIntegration(root, project)).authMode, 'required');

    await installIntegration(root, project, 'auth-mode-test', { authMode:'optional' });
    html = await readFile(join(root, 'index.html'), 'utf8');
    assert.match(html, /data-auth="optional"/);
    assert.equal((html.match(/NAKWOL-CONNECT:START/g) || []).length, 1);
    assert.equal((await inspectIntegration(root, project)).authMode, 'optional');
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('project config persists auth mode and legacy config defaults to required', async () => {
  const root = await makeProject();
  try {
    await writeProjectConfig(root, {
      clientId:'auth-mode-test', framework:'vite', redirectUris:['http://localhost:5173/'],
      integration:'universal-embed', authMode:'optional', dataScopes:[],
    });
    assert.equal((await readProjectConfig(root)).authMode, 'optional');

    await writeFile(join(root, '.nakwol-connect.json'), JSON.stringify({
      version:2, clientId:'legacy', framework:'vite', redirectUris:[], integration:'universal-embed', dataScopes:[],
    }));
    assert.equal((await readProjectConfig(root)).authMode, 'required');
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('invalid auth mode is rejected', async () => {
  const root = await makeProject();
  try {
    const project = await detectProject(root);
    await assert.rejects(() => installIntegration(root, project, 'auth-mode-test', { authMode:'maybe' }), /CONNECT_INVALID_AUTH_MODE/);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
