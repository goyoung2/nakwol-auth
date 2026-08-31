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

test('AUTH release candidate is version 0.2.0 across package, health and landing routes', async () => {
  const pkg = JSON.parse(await root('package.json')) as { version: string };
  const index = await root('src/index.ts');

  assert.equal(pkg.version, '0.2.0');
  assert.match(index, /version:\s*'0\.2\.0'/);
  assert.match(index, /낙월 통합 인증 서비스 v0\.2/);
  assert.match(index, /href="\/account"/);
  assert.match(index, /href="\/lab"/);
});

test('public docs describe immutable v0.1, pinned v0.2, Identity Menu, Account Center and Auth Lab', async () => {
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

  assert.match(readme, /AUTH.*0\.2\.0/is);
  assert.match(readme, /Connect.*0\.4\.0/is);
  assert.match(readme, /DATA.*0\.9\.0/is);
  assert.match(readme, /\/account/);
  assert.match(readme, /\/lab/);

  assert.match(handoff, /DATA 0\.9\.0/);
  assert.match(handoff, /Connect.*0\.4\.0/is);
  assert.match(handoff, /AUTH.*0\.2\.0.*release candidate/is);
});

test('AUTH v0.2 release notes remain release-candidate-only until stable production smoke', async () => {
  const notes = await root('docs/releases/2026-08-29-nakwol-auth-v0.2.md');

  assert.match(notes, /release candidate until stable production smoke succeeds/i);
  assert.match(notes, /SDK v0\.2/i);
  assert.match(notes, /Account Center/i);
  assert.match(notes, /Auth Lab/i);
  assert.match(notes, /v0\.1.*immutable/is);
  assert.match(notes, /git rev-parse stable/);
  assert.match(notes, /Worker Version ID/i);
  assert.match(notes, /V1.*V12/s);
});
