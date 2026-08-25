import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONNECT_DEVICE_TTL_MS,
  CONNECT_DEVICE_POLL_INTERVAL_SECONDS,
  CONNECT_CLI_TOKEN_TTL_MS,
  CONNECT_MAX_PENDING_DEVICE_REQUESTS,
} from '../../src/connect-cli-store';

test('uses short-lived device grants, bounded pending queue, and 30-day CLI sessions', () => {
  assert.equal(CONNECT_DEVICE_TTL_MS, 10 * 60 * 1000);
  assert.equal(CONNECT_DEVICE_POLL_INTERVAL_SECONDS, 3);
  assert.equal(CONNECT_MAX_PENDING_DEVICE_REQUESTS, 200);
  assert.equal(CONNECT_CLI_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test('migration creates CLI authorization tables and internal app', async () => {
  const sql = await readFile(new URL('../../migrations/0004_nakwol_connect_cli.sql', import.meta.url), 'utf8');
  for (const table of ['connect_developers', 'application_owners', 'connect_device_requests', 'connect_cli_tokens']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /'nakwol-connect-cli'/);
  assert.match(sql, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/connect\/cli\/device\/verify/);
});
