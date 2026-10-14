import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { registerInstallationWizardRoutes } from '../../src/install-wizard';
import type { Env } from '../../src/types';

const app = new Hono<{ Bindings: Env }>();
registerInstallationWizardRoutes(app);
const configuration = { url: 'https://site.example/', provider: 'cloudflare-pages', projectName: 'site', assets: 'dist', accessPolicy: 'member' };
const request = (body: unknown, origin = 'https://auth.example') => app.request('https://auth.example/developer/install/plan', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('web planner requires same origin and accepts only public configuration', async () => {
  assert.equal((await request(configuration, 'https://other.example')).status, 403);
  assert.equal((await request({ ...configuration, secret: 'must-not-be-accepted' })).status, 400);
  assert.equal((await request({ ...configuration, url: 'https://user:password@site.example/' })).status, 400);
  assert.equal((await request({ ...configuration, assets: '../private' })).status, 400);
  assert.equal((await request({ ...configuration, projectName: 'bad; command' })).status, 400);
  assert.equal((await request({ ...configuration, url: 'x'.repeat(5000) })).status, 413);
});

test('web plans preserve required policy, pin current AUTH host and remain incomplete', async () => {
  const response = await request(configuration);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const plan = await response.json();
  assert.equal(plan.completed, false);
  assert.equal(plan.authMode, 'required');
  assert.equal(plan.authOrigin, 'https://auth.example');
  assert.equal(plan.accessPolicy, 'member');
  assert.ok(plan.steps.some((step: { id: string }) => step.id === 'gate'));
  assert.ok(plan.steps.some((step: { id: string }) => step.id === 'verify'));
});

test('static-only hosting never offers a pretend server gate install', async () => {
  const plan = await (await request({ ...configuration, provider: 'github-pages' })).json();
  assert.ok(plan.steps.some((step: { id: string }) => step.id === 'hosting'));
  assert.ok(plan.steps.every((step: { commands: string[] }) => step.commands.every(command => !command.includes('protect install'))));
});

test('studio page is a public no-store guide with no secrets or app mutation', async () => {
  const response = await app.request('https://auth.example/developer/install');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  const html = await response.text();
  assert.ok(html.includes('id="settings"'));
  assert.ok(html.includes('/developer/install/plan'));
  assert.ok(!html.includes('type="password"'));
});
