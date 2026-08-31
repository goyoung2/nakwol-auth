import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Account Center maps only AUTH-level access policies to user-facing permissions', async () => {
  const { permissionLabelsForAccessPolicy, toConnectedServiceSummary } = await import('../../src/account-store');

  assert.deepEqual(permissionLabelsForAccessPolicy('public'), ['NAKWOL 기본 프로필 확인']);
  assert.deepEqual(permissionLabelsForAccessPolicy('member'), ['NAKWOL 기본 프로필 확인', '낙월 맹원 여부 확인']);
  assert.deepEqual(permissionLabelsForAccessPolicy('admin'), ['NAKWOL 기본 프로필 확인', '낙월 관리자 여부 확인']);

  assert.deepEqual(
    toConnectedServiceSummary({
      client_id: 'siege-calculator',
      name: '공성 시간 계산기',
      homepage_url: 'https://siege-calculator.pages.dev/',
      access_policy: 'public',
      last_authorized_at: 123,
    }),
    {
      client_id: 'siege-calculator',
      name: '공성 시간 계산기',
      homepage_url: 'https://siege-calculator.pages.dev/',
      last_authorized_at: 123,
      permissions: ['NAKWOL 기본 프로필 확인'],
    }
  );
});

test('connected services come only from this user successful AUTH evidence and exclude internal apps', async () => {
  const source = await root('src/account-store.ts');

  assert.match(source, /FROM auth_events e/);
  assert.match(source, /e\.user_id\s*=\s*\?/);
  assert.match(source, /discord\.login\.success/);
  assert.match(source, /authorize\.sso/);
  assert.match(source, /a\.status\s*=\s*'active'/);
  assert.match(source, /COALESCE\(s\.framework,'?'?'?\)\s*<>\s*'internal'/);
  assert.doesNotMatch(source, /services\/data|roster:|decks:|equipment:/);
});

test('account summary API requires an Account Center-bound access token and stays same-origin', async () => {
  const source = await root('src/account.ts');

  assert.match(source, /app\.get\('\/account\/api\/summary'/);
  assert.match(source, /Authorization/);
  assert.match(source, /authenticateAccessToken\(c\.env,\s*token,\s*ACCOUNT_CLIENT_ID\)/);
  assert.match(source, /getUserWithMembership\(c\.env,\s*userId\)/);
  assert.match(source, /listConnectedServices\(c\.env,\s*userId\)/);
  assert.match(source, /401/);
  assert.match(source, /404/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin|withCorsHeaders/);
});
