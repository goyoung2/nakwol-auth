import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('DATA Lab uses a dedicated operator-only AUTH application with exact DATA callback', async () => {
  const sql = await root('migrations/0006_data_lab.sql');

  assert.match(sql, /nakwol-data-lab/);
  assert.match(sql, /https:\/\/nakwol-data\.sepsd21\.workers\.dev\/lab/);
  assert.match(sql, /'internal'/);
  assert.match(sql, /'lab'/);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/g);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('lab application policy reuses the Auth Lab admin or active developer/operator privilege', async () => {
  const policy = await root('src/policy.ts');
  assert.match(policy, /ApplicationAccessPolicy\s*=.*'lab'/s);
  assert.match(policy, /row\?\.access_policy\s*===\s*'lab'/);
  assert.match(policy, /getAuthLabPrivilege/);
  assert.match(policy, /privilege\.canUseLab/);
});

test('AUTH production deployment verifies the DATA Lab client after migrations', async () => {
  const workflow = await root('.github/workflows/deploy.yml');
  assert.match(workflow, /nakwol-data-lab/);
});
