import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = (path:string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const guardPath = fileURLToPath(new URL('../../scripts/verify-stable-promotion.mjs', import.meta.url));

async function optional(path:string):Promise<string> {
  try { return await root(path); }
  catch { return ''; }
}

function runGuard(args:string[], env:Record<string,string>):Promise<{code:number|null;stdout:string;stderr:string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [guardPath, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withPullServer<T>(pulls:unknown[], fn:(apiOrigin:string)=>Promise<T>):Promise<T> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(pulls));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_REQUIRED');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('repository documents define dev -> main -> stable and current production boundary', async () => {
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

test('free private repository boundary preserves long-lived branches without native protection', async () => {
  const branching = await optional('BRANCHING.md');
  const handoff = await optional('CODEX_HANDOFF.md');
  assert.match(branching, /GitHub Free/i);
  assert.match(branching, /private/i);
  assert.match(branching, /Branch Protection/i);
  assert.match(branching, /direct push/i);
  assert.match(branching, /Automatically delete head branches[^\n]*(OFF|disabled)/i);
  assert.match(handoff, /default branch[^\n]*dev/i);
  assert.match(handoff, /delete merged head branches[^\n]*disabled/i);
  assert.match(handoff, /dev[^\n]*main[^\n]*stable[^\n]*(preserv|보존)/i);
  assert.match(handoff, /Branch Protection[^\n]*(unavailable|not active|disabled|사용하지)/i);
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
  assert.match(release, /gh release create/);
  assert.match(release, /merge-base --is-ancestor/);
  assert.equal(typeof descriptor.enabled, 'boolean');
  assert.equal(descriptor.component, 'data');
  assert.equal(descriptor.version, '0.8.0');
  assert.equal(descriptor.target_sha, '5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61');
  assert.equal(descriptor.notes_file, 'docs/releases/2026-08-27-nakwol-data-v0.8.md');

  assert.equal(oldGovernance, '');
  assert.equal(oldApplyWorkflow, '');
  assert.match(stableGuard, /GITHUB_EVENT_NAME/);
  assert.match(stableGuard, /GITHUB_EVENT_PATH/);
  assert.match(stableGuard, /forced/);
  assert.match(stableGuard, /merge_commit_sha/);
  assert.match(stableGuard, /base[^\n]*stable/i);
  assert.match(stableGuard, /pulls/);
  assert.match(stableGuard, /NAKWOL_STABLE_PROMOTION_OK/);
});

test('stable promotion guard permits stable manual dispatch and rejects other manual refs', async () => {
  const args = ['--allow-head', 'main', '--allow-prefix', 'hotfix/'];
  const allowed = await runGuard(args, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'stable' });
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.match(allowed.stdout, /NAKWOL_STABLE_PROMOTION_MANUAL_OK:stable/);

  const rejected = await runGuard(args, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_NAME: 'dev' });
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /MANUAL_PRODUCTION_REF_MUST_BE_STABLE/);
});

test('stable promotion guard accepts exact allowed PR merge and rejects forced replay', async () => {
  const sha = 'a'.repeat(40);
  const dir = await mkdtemp(join(tmpdir(), 'nakwol-stable-guard-'));
  const eventPath = join(dir, 'event.json');
  const pulls = [{
    number: 123,
    merge_commit_sha: sha,
    merged_at: '2026-08-29T00:00:00Z',
    base: { ref: 'stable' },
    head: { ref: 'main' },
  }];
  try {
    await withPullServer(pulls, async (apiOrigin) => {
      const common = {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_NAME: 'stable',
        GITHUB_REPOSITORY: 'goyoung2/nakwol-auth',
        GITHUB_SHA: sha,
        GITHUB_TOKEN: 'test-token',
        GITHUB_API_URL: apiOrigin,
        GITHUB_EVENT_PATH: eventPath,
      };
      await writeFile(eventPath, JSON.stringify({ forced: false, ref: 'refs/heads/stable', after: sha }));
      const allowed = await runGuard(['--allow-head', 'main', '--allow-prefix', 'hotfix/'], common);
      assert.equal(allowed.code, 0, allowed.stderr);
      assert.match(allowed.stdout, /NAKWOL_STABLE_PROMOTION_OK:main->stable:#123/);

      await writeFile(eventPath, JSON.stringify({ forced: true, ref: 'refs/heads/stable', after: sha }));
      const forced = await runGuard(['--allow-head', 'main', '--allow-prefix', 'hotfix/'], common);
      assert.notEqual(forced.code, 0);
      assert.match(forced.stderr, /STABLE_FORCE_PUSH_REJECTED/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
