import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClientId,
  validateConnectRedirectUri,
  resolveDevicePollStatus,
  canDeveloperManageApp,
} from '../../src/connect-cli-domain';

test('normalizes a project name to a client id', () => {
  assert.equal(normalizeClientId('낙월 Battle Map'), 'battle-map');
});

test('accepts localhost and https redirect URIs only', () => {
  assert.equal(validateConnectRedirectUri('http://localhost:5173/').ok, true);
  assert.equal(validateConnectRedirectUri('https://tool.pages.dev/').ok, true);
  assert.deepEqual(validateConnectRedirectUri('http://example.com/'), { ok: false, code: 'HTTPS_REQUIRED' });
});

test('expires pending device requests by time', () => {
  assert.equal(resolveDevicePollStatus('pending', 1000, 1001), 'expired');
});

test('owners and operators may manage apps', () => {
  assert.equal(canDeveloperManageApp({ isOperator: false, userId: 'u1', ownerUserIds: ['u1'] }), true);
  assert.equal(canDeveloperManageApp({ isOperator: true, userId: 'u2', ownerUserIds: [] }), true);
  assert.equal(canDeveloperManageApp({ isOperator: false, userId: 'u2', ownerUserIds: ['u1'] }), false);
});
