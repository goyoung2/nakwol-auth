import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path:string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

async function optional(path:string):Promise<string> {
  try { return await root(path); }
  catch { return ''; }
}

test('repository documents define dev -> main -> stable and Codex production boundary', async () => {
  const branching = await optional('BRANCHING.md');
  const handoff = await optional('CODEX_HANDOFF.md');
  assert.match(branching, /dev\s*[-=]+>\s*main\s*[-=]+>\s*stable/i);
  assert.match(branching, /hotfix\//i);
  assert.match(branching, /data-vX\.Y\.Z/i);
  assert.match(handoff, /DATA\s+0\.8\.0/i);
  assert.match(handoff, /schema\s+3/i);
  assert.match(handoff, /canonical applicability[^\n]*0/i);
  assert.match(handoff, /2bea00a2-c4b1-4f8c-a521-8c64f18f10be/);
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

test('production-capable push workflows target stable instead of main', async () => {
  for (const path of ['.github/workflows/deploy.yml','.github/workflows/deploy-data.yml','.github/workflows/bootstrap-data.yml','.github/workflows/publish-npm.yml']) {
    const workflow = await optional(path);
    assert.match(workflow, /stable/, path);
    const pushBlock = workflow.match(/push:\s*\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? '';
    assert.doesNotMatch(pushBlock, /\bmain\b/, path);
  }
  const deploy = await optional('.github/workflows/deploy.yml');
  assert.match(deploy, /!tests\/worker\/repository-governance\.test\.ts/);
  assert.match(deploy, /!scripts\/apply-repository-governance\.mjs/);
  const smoke = await optional('.github/workflows/production-smoke.yml');
  assert.match(smoke, /pull_request:[\s\S]*stable/, 'production-smoke.yml');
});

test('release and protection automation are explicit and fail closed', async () => {
  const release = await optional('.github/workflows/create-component-release.yml');
  const descriptor = await optional('ops/release.json');
  const governance = await optional('scripts/apply-repository-governance.mjs');
  const applyWorkflow = await optional('.github/workflows/apply-repository-governance.yml');

  assert.match(release, /branches:[\s\S]*stable/);
  assert.match(release, /ops\/release\.json/);
  assert.match(release, /contents:\s*write/);
  assert.match(release, /gh release create/);
  assert.match(release, /merge-base --is-ancestor/);
  assert.match(descriptor, /"enabled"\s*:\s*false/);
  assert.match(descriptor, /"component"\s*:\s*"data"/);
  assert.match(descriptor, /5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61/);

  for (const branch of ['dev','main','stable']) assert.match(governance, new RegExp(`['\"]${branch}['\"]`));
  assert.match(governance, /required_approving_review_count[^\n]*0/);
  assert.match(governance, /allow_force_pushes[^\n]*false/);
  assert.match(governance, /allow_deletions[^\n]*false/);
  assert.match(applyWorkflow, /workflow_dispatch:/);
  assert.match(applyWorkflow, /REPO_ADMIN_TOKEN/);
});
