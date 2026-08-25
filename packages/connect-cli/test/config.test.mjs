import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  buildProjectConfig,
  sessionFilePath,
} from '../lib/config.mjs';

test('project config contains integration metadata but never credentials', () => {
  const config = buildProjectConfig({
    clientId: 'battle-map',
    framework: 'react',
    redirectUris: ['http://localhost:5173/'],
  });
  assert.deepEqual(config, {
    version: 1,
    clientId: 'battle-map',
    framework: 'react',
    redirectUris: ['http://localhost:5173/'],
    integration: 'universal-embed',
  });
  assert.doesNotMatch(JSON.stringify(config), /access[_-]?token|secret|device[_-]?code/i);
});

test('session token path lives under user home, not project root', () => {
  const home = path.join(os.tmpdir(), 'nakwol-home');
  const sessionPath = sessionFilePath(home);
  assert.equal(sessionPath, path.join(home, '.nakwol', 'connect', 'session.json'));
});
