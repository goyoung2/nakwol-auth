import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('My Data DATA application is seeded with the complete scope set non-destructively', async () => {
  const sql = await root('services/data/migrations/0005_my_data.sql');
  assert.match(sql, /nakwol-my-data/);
  for (const scope of [
    'profile:read','profile:write','roster:read','roster:write',
    'equipment:read','equipment:write','decks:read','decks:write',
  ]) assert.ok(sql.includes(scope), `missing My Data scope ${scope}`);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/);
  assert.match(sql, /ON CONFLICT\(client_id,scope\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('DATA Worker exposes a separate user-facing My Data route built on Connect high-level SDK', async () => {
  const index = await root('services/data/src/index.ts');
  const page = await root('services/data/src/my-data.ts');

  assert.match(index, /registerMyDataRoutes\(app\)/);
  assert.match(page, /app\.get\('\/my-data'/);
  assert.match(page, /NAKWOL My Data/);
  assert.match(page, /nakwol-auth\.sepsd21\.workers\.dev\/connect\/v1\.js/);
  assert.match(page, /data-client-id="nakwol-my-data"/);
  assert.match(page, /data-ui="headless"/);
  for (const scope of [
    'profile:read','profile:write','roster:read','roster:write',
    'equipment:read','equipment:write','decks:read','decks:write',
  ]) assert.ok(page.includes(scope), `My Data page must declare ${scope}`);

  assert.match(page, /data\(\)\.accounts\.list\(\)/);
  assert.match(page, /data\(\)\.accounts\.create\(/);
  assert.match(page, /api\.roster\.generals\.list\(/);
  assert.match(page, /api\.roster\.tactics\.list\(/);
  assert.match(page, /api\.equipment\.list\(/);
  assert.match(page, /api\.decks\.list\(/);
  assert.doesNotMatch(page, /getAccessToken\(\)/);
  assert.doesNotMatch(page, /Authorization['"]?\s*,/);
});

test('My Data foundation includes account onboarding, selection, overview and explicit non-destructive empty states', async () => {
  const page = await root('services/data/src/my-data.ts');
  for (const expected of [
    '게임 계정', '새 게임 계정', '내 장수', '내 전법', '내 장비', '내 덱',
    'nickname', 'server_code', 'is_primary', '등록된 게임 계정이 없습니다',
  ]) assert.ok(page.includes(expected), `My Data page must include ${expected}`);
  assert.match(page, /aria-live=/);
  assert.match(page, /@media/);
});

test('DATA deployment verifies My Data scopes and production page', async () => {
  const workflow = await root('.github/workflows/deploy-data.yml');
  assert.match(workflow, /nakwol-my-data/);
  assert.match(workflow, /profile:read/);
  assert.match(workflow, /decks:write/);
  assert.match(workflow, /\/my-data/);
  assert.match(workflow, /NAKWOL My Data/);
});
