// server/services/attachments/converters/docx.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertDocxToMarkdown } from './docx.js';

const pandocOk = (() => {
  try { return spawnSync('pandoc', ['--version']).status === 0; }
  catch { return false; }
})();

test('convertDocxToMarkdown extracts text from a docx', { skip: pandocOk ? false : 'pandoc not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docx-fixture-'));
  const mdPath = join(dir, 'in.md');
  const docxPath = join(dir, 'in.docx');
  try {
    writeFileSync(mdPath, '# Title One\n\nHello world paragraph.\n');
    const r = spawnSync('pandoc', ['-f', 'markdown', '-t', 'docx', '-o', docxPath, mdPath]);
    assert.equal(r.status, 0, 'pandoc should produce a docx fixture');

    const md = await convertDocxToMarkdown(readFileSync(docxPath));
    assert.match(md, /Title One/);
    assert.match(md, /Hello world paragraph/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('convertDocxToMarkdown rejects clearly when pandoc is missing', { skip: pandocOk ? 'pandoc is installed' : false }, async () => {
  await assert.rejects(() => convertDocxToMarkdown(Buffer.from('x')), /pandoc is not installed/);
});
