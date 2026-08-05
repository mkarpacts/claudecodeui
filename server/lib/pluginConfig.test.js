// server/lib/pluginConfig.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  isPluginCommandPath,
  pluginConfigsFromEnv,
  pluginCommandDirs,
} from './pluginConfig.js';

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

test('isPluginCommandPath: allows commands under configured plugin command directories', () => {
  const toolsRoot = path.resolve('plugins', 'cts-tools');
  const bughunterRoot = path.resolve('plugins', 'cts-bughunter');
  const env = `${toolsRoot},${bughunterRoot}`;

  assert.equal(
    isPluginCommandPath(
      path.join(bughunterRoot, 'commands', 'cts-bughunter-linux.md'),
      env,
    ),
    true,
  );
});

test('isPluginCommandPath: rejects paths outside configured plugin command directories', () => {
  const pluginRoot = path.resolve('plugins', 'cts-bughunter');
  const siblingRoot = path.resolve('plugins', 'cts-bughunter-copy');

  assert.equal(isPluginCommandPath(path.join(pluginRoot, 'scripts', 'run.js'), pluginRoot), false);
  assert.equal(
    isPluginCommandPath(path.join(siblingRoot, 'commands', 'cts-bughunter-linux.md'), pluginRoot),
    false,
  );
  assert.equal(isPluginCommandPath(path.join(pluginRoot, 'commands'), pluginRoot), false);
});
