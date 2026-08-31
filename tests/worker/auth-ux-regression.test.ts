import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('AUTH UX v1 preserves OAuth, PKCE, state and CORS security guards', async () => {
  const index = await root('src/index.ts');
  const sdk = await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');

  assert.match(index, /INVALID_REDIRECT_URI/);
  assert.match(index, /method\s*!==\s*'S256'/);
  assert.match(index, /CORS_DENIED/);
  assert.match(index, /isAllowedOrigin/);
  assert.match(sdk, /STATE_OR_PKCE_MISMATCH/);
  assert.match(sdk, /sessionStorage/);
  assert.match(sdk, /code_challenge_method/);
  assert.match(sdk, /'S256'/);
});

test('AUTH runtime contract is version 0.2.0 across package, health and landing routes', async () => {
  const pkg = JSON.parse(await root('package.json')) as { version: string };
  const index = await root('src/index.ts');

  assert.equal(pkg.version, '0.2.0');
  assert.match(index, /version:\s*'0\.2\.0'/);
  assert.match(index, /낙월 통합 인증 서비스 v0\.2/);
  assert.match(index, /href="\/account"/);
  assert.match(index, /href="\/lab"/);
});

test('public docs describe the verified AUTH 0.2 release candidate and gate formal release on final stable promotion', async () => {
  const sdkDoc = await root('WEB_SDK.md');
  const readme = await root('README.md');
  const handoff = await root('CODEX_HANDOFF.md');

  assert.match(sdkDoc, /v0\.1\.0.*immutable/is);
  assert.match(sdkDoc, /sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(sdkDoc, /mountNakwolIdentityMenu/);
  assert.match(sdkDoc, /--nakwol-auth-accent/);
  assert.match(sdkDoc, /--nakwol-auth-shadow/);
  assert.match(sdkDoc, /\/account/);
  assert.match(sdkDoc, /\/lab/);

  assert.match(readme, /production runtime:\s*\*\*AUTH 0\.2\.0\*\*/i);
  assert.match(readme, /Connect.*0\.4\.0/is);
  assert.match(readme, /DATA.*0\.9\.0/is);
  assert.match(readme, /\/account/);
  assert.match(readme, /\/lab/);
  assert.match(readme, /V1.*V12.*completed/is);
  assert.match(readme, /V8-B.*waiver/is);
  assert.match(readme, /formal.*release.*pending.*final.*stable/is);

  assert.match(handoff, /current production runtime:\s*\*\*AUTH 0\.2\.0\*\*/i);
  assert.match(handoff, /2ea002dca18cbb064be089167326cd311b315dd5/);
  assert.match(handoff, /33350989974/);
  assert.match(handoff, /33351486056/);
  assert.match(handoff, /Connect.*0\.4\.0/is);
  assert.match(handoff, /DATA 0\.9\.0/);
  assert.match(handoff, /V1.*V12.*completed/is);
  assert.match(handoff, /V8-B.*waiver/is);
  assert.match(handoff, /formal.*release.*pending.*final.*stable/is);
});

test('AUTH v0.2 release notes retain deployment evidence and gate formal release on the verified stable target', async () => {
  const notes = await root('docs/releases/2026-08-29-nakwol-auth-v0.2.md');

  assert.match(notes, /release candidate verified.*formal.*release.*pending.*final stable/is);
  assert.match(notes, /SDK v0\.2/i);
  assert.match(notes, /Account Center/i);
  assert.match(notes, /Auth Lab/i);
  assert.match(notes, /v0\.1.*immutable/is);
  assert.match(notes, /2ea002dca18cbb064be089167326cd311b315dd5/);
  assert.match(notes, /33350989974/);
  assert.match(notes, /f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4/);
  assert.match(notes, /33351486056/);
  assert.match(notes, /V1.*V12/s);
  assert.match(notes, /V8-B.*waiver/is);
  assert.match(notes, /target_sha.*stable/is);
});

test('production smoke covers AUTH 0.2, Connect 0.4 and DATA 0.9 without mutating device state', async () => {
  const workflow = await root('.github/workflows/production-smoke.yml');

  assert.match(workflow, /AUTH v0\.2, Connect v0\.4 and DATA v0\.9/);
  assert.match(workflow, /sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(workflow, /\/account/);
  assert.match(workflow, /\/lab/);
  assert.match(workflow, /NAKWOL Connect CLI v0\.4/);
  assert.match(workflow, /"version":"0\.9\.0"/);
  assert.match(workflow, /nakwol-account-center/);
  assert.match(workflow, /nakwol-auth-lab/);
  assert.doesNotMatch(workflow, /connect\/cli\/device\/start/);
  assert.doesNotMatch(workflow, /curl[^\n]*\s-d\s/);
});

test('production deploy ignores test-only changes while keeping runtime triggers', async () => {
  const workflow = await root('.github/workflows/deploy.yml');

  assert.doesNotMatch(workflow, /^\s*-\s*'tests\/\*\*'\s*$/m);
  assert.doesNotMatch(workflow, /^\s*-\s*'!tests\//m);
  for (const runtimePath of ['src/**', 'packages/**', 'migrations/**', 'scripts/**', 'package.json', 'wrangler.jsonc']) {
    assert.ok(workflow.includes(`'${runtimePath}'`), `AUTH deploy must still watch ${runtimePath}`);
  }
});
