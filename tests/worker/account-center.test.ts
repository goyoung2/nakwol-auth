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

test('Account Center UI uses pinned SDK v0.2 and explicit account states/actions', async () => {
  const { accountPageHtml } = await import('../../src/account');
  const html = accountPageHtml();

  for (const text of [
    '/sdk/v0.2.0/nakwol-auth-web.js',
    'nakwol-account-center',
    'Discord로 낙월 로그인',
    'NAKWOL ID',
    '연결된 서비스',
    '서비스 권한',
    '모든 낙월 서비스에서 로그아웃',
    '아직 표시할 연결 서비스 기록이 없습니다.',
  ]) {
    assert.ok(html.includes(text), `Account Center HTML must include: ${text}`);
  }

  for (const id of [
    'account-identity',
    'logged-out',
    'login',
    'account-content',
    'profile-card',
    'membership-card',
    'services-card',
    'services',
    'permissions',
    'permission-detail',
    'global-logout',
    'account-error',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }

  assert.match(html, /new NakwolAuthClient\(\{\s*clientId:\s*ACCOUNT_CLIENT_ID/);
  assert.match(html, /redirectUri:\s*location\.origin\s*\+\s*'\/account'/);
  assert.match(html, /fetch\('\/account\/api\/summary'/);
  assert.match(html, /auth\.getAccessToken\(\)/);
  assert.match(html, /textContent/);
  assert.match(html, /new URLSearchParams\(location\.search\).*client_id/s);
  assert.match(html, /location\.hash\s*===\s*'#permissions'/);
  assert.match(html, /confirm\(/);
  assert.match(html, /auth\.logout\(\{\s*global:\s*true,\s*returnTo:\s*location\.origin\s*\+\s*'\/account'\s*\}\)/);
});
