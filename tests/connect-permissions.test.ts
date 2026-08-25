import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageApplication,
  canManageDeveloperRoles,
  canUseCli,
} from '../src/connect-permissions';

test('developer can authenticate the Connect CLI', () => {
  assert.equal(canUseCli('developer', 'member'), true);
});

test('ordinary member cannot authenticate the Connect CLI', () => {
  assert.equal(canUseCli(null, 'member'), false);
});

test('Discord admin can authenticate the Connect CLI without an operator row', () => {
  assert.equal(canUseCli(null, 'admin'), true);
});

test('developer can manage only an application they own', () => {
  assert.equal(canManageApplication('developer', 'member', 'usr_dev', 'usr_dev'), true);
  assert.equal(canManageApplication('developer', 'member', 'usr_dev', 'usr_other'), false);
});

test('owner and operator can manage any application', () => {
  assert.equal(canManageApplication('owner', 'member', 'usr_owner', 'usr_other'), true);
  assert.equal(canManageApplication('operator', 'member', 'usr_op', 'usr_other'), true);
});

test('Discord admin can manage any application', () => {
  assert.equal(canManageApplication(null, 'admin', 'usr_admin', 'usr_other'), true);
});

test('only owner/operator/Discord admin can manage developer roles', () => {
  assert.equal(canManageDeveloperRoles('owner', 'member'), true);
  assert.equal(canManageDeveloperRoles('operator', 'member'), true);
  assert.equal(canManageDeveloperRoles(null, 'admin'), true);
  assert.equal(canManageDeveloperRoles('developer', 'member'), false);
});
