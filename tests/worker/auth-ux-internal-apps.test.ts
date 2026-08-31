import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('AUTH UX internal clients use exact production callbacks and non-destructive UPSERTs', async () => {
  const sql = await root('migrations/0005_auth_ux_v1.sql');

  assert.match(sql, /nakwol-account-center/);
  assert.match(sql, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/account/);
  assert.match(sql, /nakwol-auth-lab/);
  assert.match(sql, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/lab/);
  assert.match(sql, /'internal'/);
  assert.match(sql, /'public'/);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/g);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('Account Center and Auth Lab expose stable client ids and focused route shells', async () => {
  const account = await root('src/account.ts');
  const lab = await root('src/lab.ts');

  assert.match(account, /ACCOUNT_CLIENT_ID\s*=\s*'nakwol-account-center'/);
  assert.match(account, /registerAccountRoutes/);
  assert.match(account, /app\.get\('\/account'/);
  assert.match(account, /NAKWOL 계정/);

  assert.match(lab, /LAB_CLIENT_ID\s*=\s*'nakwol-auth-lab'/);
  assert.match(lab, /registerLabRoutes/);
  assert.match(lab, /app\.get\('\/lab'/);
  assert.match(lab, /NAKWOL AUTH LAB/);
});

test('production entry registers both AUTH UX route modules', async () => {
  const entry = await root('src/sdk-entry.ts');

  assert.match(entry, /registerAccountRoutes\(app\)/);
  assert.match(entry, /registerLabRoutes\(app\)/);
});
