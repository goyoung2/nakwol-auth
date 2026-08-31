import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const optional = async (path: string) => { try { return await root(path); } catch { return ''; } };

test('repository documents define dev -> main -> stable and current production boundary', async () => {
  const branching = await root('BRANCHING.md');
  const agents = await root('AGENTS.md');
  const handoff = await root('CODEX_HANDOFF.md');
  const readme = await root('README.md');
  const data = await root('DATA.md');
  const releaseNotes = await root('docs/releases/2026-08-27-nakwol-data-v0.8.md');

  for (const source of [branching, agents, handoff]) {
    assert.match(source, /dev\s*->\s*main\s*->\s*stable/i);
  }
  assert.match(branching, /default branch[^\n]*`dev`/i);
  assert.match(branching, /delete merged head branches[^\n]*disabled/i);
  assert.match(branching, /GitHub Free/i);
  assert.match(branching, /Branch Protection[^\n]*(unavailable|not active)/i);
  assert.match(branching, /do not direct-push/i);
  assert.match(branching, /do not force-push/i);
  assert.match(branching, /do not auto-delete/i);

  assert.match(handoff, /DATA 0\.8\.0/);
  assert.match(handoff, /schema 3/i);
  assert.match(handoff, /data-v0\.8\.0/);
  assert.match(handoff, /2bea00a2-c4b1-4f8c-a521-8c64f18f10be/);
  assert.match(handoff, /5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61/);
  assert.match(handoff, /33157010443/);
  assert.match(handoff, /canonical applicability[^\n]*0/i);
  assert.match(handoff, /do not infer/i);
  assert.match(handoff, /Never DELETE\/TRUNCATE user-owned data/i);

  assert.match(readme, /DATA[^\n]*0\.9\.0/i);
  assert.match(data, /DATA v0\.8\.0/);
  assert.match(releaseNotes, /data-v0\.8\.0/);
  assert.match(releaseNotes, /2bea00a2-c4b1-4f8c-a521-8c64f18f10be/);
  assert.match(releaseNotes, /5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61/);
  assert.match(releaseNotes, /33157010443/);
});

test('free private repository boundary preserves long-lived branches without native protection', async () => {
  const config = await root('.github/repository-settings.json');
  const settings = JSON.parse(config) as Record<string,unknown>;
  assert.equal(settings.default_branch, 'dev');
  assert.equal(settings.delete_branch_on_merge, false);
  assert.equal(settings.protection_mode, 'free_private_no_native_protection');
  assert.equal(settings.long_lived_branch_auto_delete, false);
  assert.deepEqual(settings.long_lived_branches, ['dev','main','stable']);

  const applyScript = await optional('scripts/apply-repository-governance.mjs');
  assert.equal(applyScript, '');
  const applyWorkflow = await optional('.github/workflows/apply-repository-governance.yml');
  assert.equal(applyWorkflow, '');
});

test('verification workflows cover all long-lived branches', async () => {
  for (const path of ['.github/workflows/verify.yml','.github/workflows/verify-data.yml','.github/workflows/repository-governance.yml']) {
    const workflow = await optional(path);
    assert.match(workflow, /pull_request:/, path);
    assert.match(workflow, /dev/, path);
    assert.match(workflow, /main/, path);
    assert.match(workflow, /stable/, path);
  }
});

test('production-capable stable push workflows fail closed behind a PR promotion guard', async () => {
  for (const path of ['.github/workflows/deploy.yml','.github/workflows/deploy-data.yml','.github/workflows/bootstrap-data.yml','.github/workflows/publish-npm.yml']) {
    const workflow = await optional(path);
    assert.match(workflow, /stable/, path);
    const pushBlock = workflow.match(/push:\s*\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? '';
    assert.doesNotMatch(pushBlock, /\bmain\b/, path);
    assert.match(workflow, /pull-requests:\s*read/, path);
    assert.match(workflow, /verify-stable-promotion\.mjs/, path);
    assert.match(workflow, /--allow-head\s+main/, path);
    assert.match(workflow, /--allow-prefix\s+hotfix\//, path);
  }
  const deploy = await optional('.github/workflows/deploy.yml');
  assert.doesNotMatch(deploy, /^\s*-\s*'tests\/\*\*'\s*$/m);
  assert.doesNotMatch(deploy, /^\s*-\s*'!tests\//m);
  assert.match(deploy, /!scripts\/verify-stable-promotion\.mjs/);
  const smoke = await optional('.github/workflows/production-smoke.yml');
  assert.match(smoke, /pull_request:[\s\S]*stable/, 'production-smoke.yml');
});

test('release automation is release-PR gated and paid protection automation is retired', async () => {
  const release = await optional('.github/workflows/create-component-release.yml');
  const descriptorText = await optional('ops/release.json');
  const descriptor = JSON.parse(descriptorText || '{}') as Record<string,unknown>;
  const oldGovernance = await optional('scripts/apply-repository-governance.mjs');
  const oldApplyWorkflow = await optional('.github/workflows/apply-repository-governance.yml');
  const stableGuard = await optional('scripts/verify-stable-promotion.mjs');

  assert.match(release, /branches:[\s\S]*stable/);
  assert.match(release, /ops\/release\.json/);
  assert.match(release, /contents:\s*write/);
  assert.match(release, /pull-requests:\s*read/);
  assert.match(release, /verify-stable-promotion\.mjs/);
  assert.match(release, /--allow-prefix\s+release\//);
  assert.match(release, /target_sha/);
  assert.equal(descriptor.enabled, false);
  assert.equal(oldGovernance, '');
  assert.equal(oldApplyWorkflow, '');
  assert.match(stableGuard, /push\/before/);
  assert.match(stableGuard, /workflow_dispatch/);
});
