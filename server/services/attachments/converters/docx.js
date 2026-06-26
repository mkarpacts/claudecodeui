// server/services/attachments/converters/docx.js
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capMarkdown } from '../truncate.js';
import { PANDOC_TIMEOUT_MS, EMPTY_NOTICE } from '../constants.js';

function runPandoc(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'pandoc',
      ['-f', 'docx', '-t', 'gfm', '--wrap=none', '--standalone', inputPath],
      { timeout: PANDOC_TIMEOUT_MS }
    );
    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout.on('data', (d) => { stdoutChunks.push(d); });
    proc.stderr.on('data', (d) => { stderrChunks.push(d); });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('docx conversion unavailable: pandoc is not installed'));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdoutChunks).toString());
      else reject(new Error(`docx conversion failed (pandoc exited ${code}): ${Buffer.concat(stderrChunks).toString().trim()}`));
    });
  });
}

/** Convert a .docx buffer to Markdown via pandoc. Cleans up its temp input in finally. */
export async function convertDocxToMarkdown(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'docx2md-'));
  const inputPath = join(dir, 'input.docx');
  try {
    await writeFile(inputPath, buffer);
    const md = (await runPandoc(inputPath)).trim();
    if (!md) return EMPTY_NOTICE;
    return capMarkdown(md);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
