// server/services/attachments/truncate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capMarkdown } from './truncate.js';
import { MAX_MD_CHARS } from './constants.js';

test('capMarkdown returns input unchanged when under the limit', () => {
  const md = '## Sheet\n\n| a | b |';
  assert.equal(capMarkdown(md), md);
});

test('capMarkdown truncates and appends a notice when over the limit', () => {
  const md = 'x'.repeat(MAX_MD_CHARS + 100);
  const out = capMarkdown(md);
  assert.ok(out.length < md.length);
  assert.match(out, /_\(truncated: exceeded 120000-character limit\)_$/);
});
