// server/lib/commandListBuilder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillEntries, dedupeByName } from './commandListBuilder.js';

test('buildSkillEntries maps supportedCommands → menu entries with namespace skill', () => {
  const out = buildSkillEntries([{ name: 'superpowers:brainstorming', description: 'd', argumentHint: '<topic>' }]);
  assert.deepEqual(out, [{
    name: '/superpowers:brainstorming',
    description: 'd',
    argumentHint: '<topic>',
    namespace: 'skill',
    metadata: { type: 'skill' },
  }]);
});

test('dedupeByName keeps first occurrence', () => {
  const out = dedupeByName([{ name: '/a' }, { name: '/a' }, { name: '/b' }]);
  assert.deepEqual(out.map((x) => x.name), ['/a', '/b']);
});
