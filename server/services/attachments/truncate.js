// server/services/attachments/truncate.js
import { MAX_MD_CHARS } from './constants.js';

export function capMarkdown(md) {
  if (md.length <= MAX_MD_CHARS) return md;
  return (
    md.slice(0, MAX_MD_CHARS) +
    `\n\n_(truncated: exceeded ${MAX_MD_CHARS}-character limit)_`
  );
}
