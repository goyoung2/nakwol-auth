import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Auth Lab is limited to membership admins or active Connect developers/operators', async () => {
  const { canUseAuthLab } = await import('../../src/platform-access');

  assert.equal(canUseAuthLab({ membershipRole: 'admin', developerRole: null }), true);
  assert.equal(canUseAuthLab({ membershipRole: 'member', developerRole: 'developer' }), true);
  assert.equal(canUseAuthLab({ membershipRole: 'user', developerRole: 'operator' }), true);
  assert.equal(canUseAuthLab({ membershipRole: 'member', developerRole: null }), false);
  assert.equal(canUseAuthLab({ membershipRole: 'user', developerRole: null }), false);
});

test('safe diagnostics whitelist contains status only and never raw secret fields', async () => {
  const { safeLabDiagnosticShape } = await import('../../src/platform-access');
  const value = safeLabDiagnosticShape({
    centralSession: true,
    appAccessToken: true,
    meStatus: 200,
    nakwolId: 'usr_test',
    clientId: 'nakwol-auth-lab',
    redirectUri: 'https://nakwol-auth.sepsd21.workers.dev/lab',
    pkceMethod: 'S256',
    tokenExpiresAt: 123,
    membershipRole: 'member',
    developerRole: 'developer',
  });

  assert.deepEqual(Object.keys(value), [
    'central_session',
    'app_access_token',
    'me_status',
    'nakwol_id',
    'client_id',
    'redirect_uri',
    'pkce_method',
    'token_expires_at',
    'membership_role',
    'developer_role',
  ]);

  const serialized = JSON.stringify(value);
  for (const forbidden of [
    /"access_token"\s*:/,
    /"token_hash"\s*:/,
    /"session_cookie"\s*:/,
    /"pkce_verifier"\s*:/,
    /"client_secret"\s*:/,
  ]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});

test('Lab privilege lookup uses guild membership plus active Connect developer state', async () => {
  const source = await root('src/platform-access.ts');
  assert.match(source, /FROM memberships/);
  assert.match(source, /guild_id\s*=\s*\?/);
  assert.match(source, /FROM connect_developers/);
  assert.match(source, /status\s*===\s*'active'/);
  assert.match(source, /developerRole/);
});

test('access-token inspection validates client binding and returns metadata without token material', async () => {
  const source = await root('src/store.ts');
  assert.match(source, /export async function inspectAccessToken/);
  assert.match(source, /FROM access_tokens WHERE token_hash = \?/);
  assert.match(source, /row\.client_id\s*!==\s*clientId/);
  assert.match(source, /userId:\s*row\.user_id/);
  assert.match(source, /clientId:\s*row\.client_id/);
  assert.match(source, /expiresAt:\s*Number\(row\.expires_at\)/);
});

test('Lab diagnostics endpoint requires a Lab-bound token, privilege, and reports only same-user central session state', async () => {
  const source = await root('src/lab.ts');
  assert.match(source, /app\.get\('\/lab\/api\/diagnostics'/);
  assert.match(source, /inspectAccessToken\(c\.env,\s*token,\s*LAB_CLIENT_ID\)/);
  assert.match(source, /getAuthLabPrivilege\(c\.env,\s*tokenInfo\.userId\)/);
  assert.match(source, /403/);
  assert.match(source, /parseCookies\(c\.req\.header\('Cookie'\)\)/);
  assert.match(source, /findSessionUser\(c\.env,\s*sid\)/);
  assert.match(source, /sessionUserId\s*===\s*tokenInfo\.userId/);
  assert.match(source, /safeLabDiagnosticShape/);
  assert.match(source, /pkceMethod:\s*'S256'/);
  assert.match(source, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/lab/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin|withCorsHeaders/);
});
