import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Connect v1 is protected by default and supports explicit optional mode', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /script\.dataset\.auth \|\| 'required'/);
  assert.match(src, /\['required', 'optional'\]\.includes\(authMode\)/);
  assert.match(src, /const authRequired = authMode === 'required'/);
  assert.match(src, /data-nakwol-connect-auth-guard/);
  assert.match(src, /document\.body\.setAttribute\('inert', ''\)/);
  assert.match(src, /setAuthGuardState\('login'\)/);
  assert.match(src, /await client\.login\(\)/);
  assert.match(src, /access_denied/);
  assert.match(src, /releaseAuthGuard\(\)/);
  assert.match(src, /version: '1\.3\.0'/);
  assert.match(src, /authMode, authRequired/);
});

test('required Connect keeps explicit logout locked instead of silently revealing the app', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /sso_suppressed/);
  assert.match(src, /if \(suppressed\) \{[\s\S]*setAuthGuardState\('loggedout'\)/);
  assert.match(src, /client\.addEventListener\('logout',[\s\S]*setAuthGuardState\('loggedout'\)/);
});
