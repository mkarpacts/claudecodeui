// server/lib/pluginConfig.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluginConfigsFromEnv, pluginCommandDirs } from './pluginConfig.js';

test('pluginConfigsFromEnv: empty/undefined → []', () => {
  assert.deepEqual(pluginConfigsFromEnv(undefined), []);
  assert.deepEqual(pluginConfigsFromEnv(''), []);
  assert.deepEqual(pluginConfigsFromEnv('   '), []);
});

test('pluginConfigsFromEnv: single path', () => {
  assert.deepEqual(pluginConfigsFromEnv('/a/plugin'), [{ type: 'local', path: '/a/plugin' }]);
});

test('pluginConfigsFromEnv: comma list, trims, drops empties', () => {
  assert.deepEqual(
    pluginConfigsFromEnv(' /a , /b/c , ,/d '),
    [{ type: 'local', path: '/a' }, { type: 'local', path: '/b/c' }, { type: 'local', path: '/d' }],
  );
});

test('pluginCommandDirs: appends /commands to each plugin root', () => {
  assert.deepEqual(pluginCommandDirs('/a,/b'), ['/a/commands', '/b/commands']);
});
