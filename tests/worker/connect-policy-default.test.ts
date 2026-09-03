import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicationAccessPolicy } from '../../src/policy';
import type { Env } from '../../src/types';

function envWithPolicy(accessPolicy: string | null): Env {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return accessPolicy == null ? null : { access_policy: accessPolicy };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  } as Env;
}

test('application access policy is member when settings are missing', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy(null), 'missing-app'), 'member');
});

test('application access policy fails closed to member when stored value is malformed', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('unexpected'), 'broken-app'), 'member');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy(''), 'empty-policy-app'), 'member');
});

test('explicit public policy remains public and valid protected policies are preserved', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('public'), 'public-app'), 'public');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('member'), 'member-app'), 'member');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('admin'), 'admin-app'), 'admin');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('lab'), 'lab-app'), 'lab');
});
