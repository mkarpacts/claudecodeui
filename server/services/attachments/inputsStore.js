// server/services/attachments/inputsStore.js
// Saves original chat-attached files into the persistent "inputs" folder.
// Never creates the folder, never deletes or overwrites existing files.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_INPUTS_DIR } from './constants.js';

const MAX_COUNTER = 10000;

export function getInputsDir() {
  return path.resolve(process.env.CLAUDE_UI_INPUTS_DIR || DEFAULT_INPUTS_DIR);
}

/** YYYY-MM-DD_HH-mm-ss from the local time components of `date`. */
export function timestampPrefix(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

/**
 * Writes `buffer` into `dir` as `filename`; on a name collision tries
 * `<ts>_<filename>`, then `<ts>_<base>_<n><ext>` (n = 1, 2, ...).
 * Exclusive create (`wx`) makes the existence check and the write one operation.
 * Any error other than EEXIST (e.g. ENOENT for a missing dir) is rethrown unchanged.
 * @returns {Promise<string>} path of the saved file
 */
export async function saveToInputs({ dir, filename, buffer, now = new Date() }) {
  const ts = timestampPrefix(now);
  const { name: base, ext } = path.parse(filename);
  const candidate = (i) => {
    if (i === 0) return filename;
    if (i === 1) return `${ts}_${filename}`;
    return `${ts}_${base}_${i - 1}${ext}`;
  };

  for (let i = 0; ; i++) {
    const target = path.join(dir, candidate(i));
    try {
      await fs.writeFile(target, buffer, { flag: 'wx' });
      return target;
    } catch (err) {
      if (err?.code !== 'EEXIST' || i > MAX_COUNTER) throw err;
    }
  }
}
