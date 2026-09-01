import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('My Data exposes user CRUD sections for generals, tactics, equipment and decks', async () => {
  const page = await root('services/data/src/my-data.ts');
  for (const label of [
    '장수 관리', '전법 관리', '장비 관리', '덱 관리',
    '보유 등록', '저장', '삭제', '새 장비 등록', '새 덱 만들기', '덱 편성',
  ]) assert.ok(page.includes(label), `My Data must expose ${label}`);

  for (const section of ['generals','tactics','equipment','decks']) {
    assert.ok(page.includes(`data-section="${section}"`), `missing My Data section ${section}`);
  }
});

test('My Data CRUD uses only the high-level Connect Data SDK for owned mutations', async () => {
  const page = await root('services/data/src/my-data.ts');
  for (const call of [
    'api.roster.generals.upsert(', 'api.roster.generals.remove(',
    'api.roster.tactics.upsert(', 'api.roster.tactics.remove(',
    'api.equipment.create(', 'api.equipment.update(', 'api.equipment.remove(',
    'api.decks.create(', 'api.decks.get(', 'api.decks.update(', 'api.decks.replaceComposition(', 'api.decks.remove(',
  ]) assert.ok(page.includes(call), `missing high-level SDK call ${call}`);

  assert.doesNotMatch(page, /data\(\)\.request\(/);
  assert.doesNotMatch(page, /getAccessToken\(\)/);
  assert.doesNotMatch(page, /Authorization['"]?\s*[,)]/);
});

test('My Data Registry selection follows production write authority', async () => {
  const page = await root('services/data/src/my-data.ts');
  assert.match(page, /api\.registry\.generals\(\{\s*includeHidden:\s*true\s*\}\)/);
  assert.match(page, /api\.registry\.tactics\(\)/);
  assert.match(page, /api\.registry\.equipment\(\)/);
  for (const projected of ['skill_class_raw','learn_times','get_type','is_copy','chip_id']) {
    assert.ok(page.includes(projected), `canonical tactic selector must use ${projected}`);
  }
  assert.match(page, /unique_tactic_id/);
  assert.match(page, /row\.enabled\s*===\s*1/);
});

test('My Data deck editor supports three positions, two tactics and owned weapon/mount instances', async () => {
  const page = await root('services/data/src/my-data.ts');
  assert.match(page, /\[1,\s*2,\s*3\]/);
  assert.ok(page.includes('tactic-1'), 'deck editor must expose tactic slot 1');
  assert.ok(page.includes('tactic-2'), 'deck editor must expose tactic slot 2');
  assert.ok(page.includes('weapon-instance'), 'deck editor must expose weapon instance');
  assert.ok(page.includes('mount-instance'), 'deck editor must expose mount instance');
  assert.match(page, /generals:\s*composition/);
});

test('My Data keeps unsupported equipment trait applicability explicit instead of inventing options', async () => {
  const page = await root('services/data/src/my-data.ts');
  assert.match(page, /장비 특성/);
  assert.match(page, /canonical applicability.*0|적용 대상 정보.*없/si);
  assert.doesNotMatch(page, /api\.equipment\.(create|update)\([^\n]+traits\s*:/);
});

test('My Data CRUD remains responsive and keeps explicit empty/error states', async () => {
  const page = await root('services/data/src/my-data.ts');
  assert.match(page, /@media\(max-width:760px\)/);
  assert.match(page, /aria-live=/);
  assert.ok(page.includes('검색 결과가 없습니다.'));
  assert.ok(page.includes('아직 등록된 장비가 없습니다.'));
  assert.ok(page.includes('아직 등록된 덱이 없습니다.'));
});

test('My Data captures submit forms before awaiting asynchronous create calls', async () => {
  const page = await root('services/data/src/my-data.ts');
  assert.doesNotMatch(page, /event\.currentTarget\.reset\(\)/);
  assert.ok((page.match(/const form = event\.currentTarget;/g) || []).length >= 2);
  assert.ok((page.match(/form\.reset\(\)/g) || []).length >= 2);
});
