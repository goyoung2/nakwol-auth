import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiscordUserId } from '../../src/connect-developer-pregrants';

test('Discord developer pregrants accept numeric user snowflakes', () => {
  assert.equal(isDiscordUserId('123456789012345678'), true);
  assert.equal(isDiscordUserId(' 123456789012345678 '), true);
});

test('Discord developer pregrants reject names, mentions, and short values', () => {
  assert.equal(isDiscordUserId('some-user'), false);
  assert.equal(isDiscordUserId('<@123456789012345678>'), false);
  assert.equal(isDiscordUserId('12345'), false);
  assert.equal(isDiscordUserId(''), false);
});