// server/lib/skillsCache.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersion, makeSkillsCache } from './skillsCache.js';

test('computeVersion changes when any input changes', () => {
  const base = { pluginsEnv: '/a,/b', pluginMtimes: [1, 2], skillsDirMtime: 10 };
  const v0 = computeVersion(base);
  assert.equal(v0, computeVersion({ ...base }));
  assert.notEqual(v0, computeVersion({ ...base, pluginsEnv: '/a' }));
  assert.notEqual(v0, computeVersion({ ...base, pluginMtimes: [1, 3] }));
  assert.notEqual(v0, computeVersion({ ...base, skillsDirMtime: 11 }));
});

test('cache returns stored skills only for matching version', () => {
  const c = makeSkillsCache();
  c.set('v1', [{ name: 'x' }]);
  assert.deepEqual(c.get('v1'), [{ name: 'x' }]);
  assert.equal(c.get('v2'), null);
});
