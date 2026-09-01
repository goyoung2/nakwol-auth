import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('My Data AUTH application is seeded as an active public internal app with exact callback', async () => {
  const sql = await root('migrations/0007_my_data.sql');
  assert.match(sql, /nakwol-my-data/);
  assert.match(sql, /NAKWOL My Data/);
  assert.match(sql, /https:\/\/nakwol-data\.sepsd21\.workers\.dev\/my-data/);
  assert.match(sql, /'internal'/);
  assert.match(sql, /'public'/);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('AUTH production deployment requires the My Data application after migrations', async () => {
  const workflow = await root('.github/workflows/deploy.yml');
  assert.match(workflow, /nakwol-my-data/);
  assert.match(workflow, /Verify required applications/);
});
