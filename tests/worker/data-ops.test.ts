import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path:string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('DATA Ops uses a dedicated internal AUTH application with exact admin policy and callback', async () => {
  const sql = await root('migrations/0008_data_ops.sql');

  assert.match(sql, /'nakwol-data-ops'/);
  assert.match(sql, /https:\/\/nakwol-data\.sepsd21\.workers\.dev\/ops/);
  assert.match(sql, /'internal'/);
  assert.match(sql, /'admin'/);
  assert.doesNotMatch(sql, /'lab'/);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/g);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('existing AUTH admin policy requires active membership admin and does not reuse Lab developer privilege', async () => {
  const policy = await root('src/policy.ts');
  assert.match(policy, /ApplicationAccessPolicy\s*=.*'admin'/s);
  assert.match(policy, /if \(policy === 'member'\) return Boolean\(user\.membership\?\.is_member\)/);
  assert.match(policy, /return user\.membership\?\.role === 'admin'/);
  assert.match(policy, /if \(policy === 'lab'\)[\s\S]*getAuthLabPrivilege/);
});

test('AUTH production deployment verifies the DATA Ops client after migrations', async () => {
  const workflow = await root('.github/workflows/deploy.yml');
  assert.match(workflow, /nakwol-data-ops/);
});