import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUserCode,
  deviceEffectiveStatus,
  isDeviceRequestConsumable,
} from '../src/connect-device-core';

test('user code is eight readable characters grouped 4-4', () => {
  const code = createUserCode(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(code, 'ABCD-EFGH');
});

test('pending request becomes expired after expires_at', () => {
  assert.equal(deviceEffectiveStatus({ status: 'pending', expires_at: 1000, consumed_at: null }, 1001), 'expired');
});

test('approved request remains approved before expiry', () => {
  assert.equal(deviceEffectiveStatus({ status: 'approved', expires_at: 2000, consumed_at: null }, 1500), 'approved');
});

test('consumed and denied are terminal states', () => {
  assert.equal(deviceEffectiveStatus({ status: 'approved', expires_at: 2000, consumed_at: 1400 }, 1500), 'consumed');
  assert.equal(deviceEffectiveStatus({ status: 'denied', expires_at: 2000, consumed_at: null }, 1500), 'denied');
});

test('only unconsumed approved non-expired request can mint a CLI token', () => {
  assert.equal(isDeviceRequestConsumable({ status: 'approved', expires_at: 2000, consumed_at: null }, 1500), true);
  assert.equal(isDeviceRequestConsumable({ status: 'pending', expires_at: 2000, consumed_at: null }, 1500), false);
  assert.equal(isDeviceRequestConsumable({ status: 'approved', expires_at: 1000, consumed_at: null }, 1500), false);
  assert.equal(isDeviceRequestConsumable({ status: 'approved', expires_at: 2000, consumed_at: 1400 }, 1500), false);
});
