import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('DATA Lab application is seeded with the complete DATA scope set non-destructively', async () => {
  const sql = await root('services/data/migrations/0004_data_lab.sql');
  assert.match(sql, /nakwol-data-lab/);
  for (const scope of [
    'profile:read','profile:write','roster:read','roster:write',
    'equipment:read','equipment:write','decks:read','decks:write',
  ]) assert.ok(sql.includes(scope), `missing DATA Lab scope ${scope}`);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/);
  assert.match(sql, /ON CONFLICT\(client_id,scope\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('DATA Worker exposes a dedicated Data Lab route using pinned AUTH SDK v0.2', async () => {
  const index = await root('services/data/src/index.ts');
  const lab = await root('services/data/src/lab.ts');

  assert.match(index, /registerDataLabRoutes\(app\)/);
  assert.match(lab, /app\.get\('\/lab'/);
  assert.match(lab, /NAKWOL DATA LAB/);
  assert.match(lab, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(lab, /clientId:\s*DATA_LAB_CLIENT_ID/);
  assert.match(lab, /redirectUri:\s*location\.origin\s*\+\s*'\/lab'/);
  assert.match(lab, /nakwol-data-lab/);
  assert.doesNotMatch(lab, /textContent\s*=\s*auth\.getAccessToken\(\)/);
});

test('DATA Lab guided smoke exercises real production CRUD paths and cleanup', async () => {
  const lab = await root('services/data/src/lab.ts');
  for (const expected of [
    '/v1/me',
    '/v1/game-accounts',
    '/v1/registry/generals',
    '/v1/registry/tactics',
    '/v1/registry/equipment',
    '/roster/generals/',
    '/roster/tactics/',
    '/equipment',
    '/decks',
    '/composition',
    "method: 'POST'",
    "method: 'PUT'",
    "method: 'PATCH'",
    "method: 'DELETE'",
    'CRUD 스모크 실행',
    '게임 계정',
    '스냅샷',
    '미지원',
  ]) assert.ok(lab.includes(expected), `DATA Lab must include ${expected}`);

  assert.match(lab, /X-NAKWOL-CLIENT-ID/);
  assert.match(lab, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.match(lab, /cleanup/i);
});

test('DATA deployment verifies the Lab page and seeded DATA scopes', async () => {
  const workflow = await root('.github/workflows/deploy-data.yml');
  assert.match(workflow, /nakwol-data-lab/);
  assert.match(workflow, /profile:read/);
  assert.match(workflow, /decks:write/);
  assert.match(workflow, /\/lab/);
  assert.match(workflow, /NAKWOL DATA LAB/);
});
