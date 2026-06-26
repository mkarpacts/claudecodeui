// server/services/attachments/index.js
import { extname, basename } from 'node:path';
import { convertDocxToMarkdown } from './converters/docx.js';
import { convertXlsxToMarkdown } from './converters/xlsx.js';
import { OFFICE } from './constants.js';

/** Returns 'docx' | 'xlsx' | null. Extension wins; MIME is a fallback (browser MIME is unreliable). */
export function detectKind(name, mimeType) {
  const ext = extname(name || '').toLowerCase();
  if (ext === OFFICE.docx.ext || mimeType === OFFICE.docx.mime) return 'docx';
  if (ext === OFFICE.xlsx.ext || mimeType === OFFICE.xlsx.mime) return 'xlsx';
  return null;
}

function toMarkdownAttachment(originalName, md) {
  const base = basename(originalName || 'document', extname(originalName || ''));
  const buf = Buffer.from(md, 'utf8'); // encode once; reused for size + base64
  return {
    name: `${base}.md`,
    mimeType: 'text/markdown',
    size: buf.length,
    data: `data:text/markdown;base64,${buf.toString('base64')}`,
  };
}

/**
 * Normalize an uploaded attachment for the chat pipeline.
 * Office files → converted Markdown (.md); everything else → base64 passthrough.
 * Throws on conversion failure (caller maps to an HTTP error).
 */
export async function processAttachment({ buffer, name, mimeType }) {
  const kind = detectKind(name, mimeType);
  if (kind === 'docx') return toMarkdownAttachment(name, await convertDocxToMarkdown(buffer));
  if (kind === 'xlsx') return toMarkdownAttachment(name, convertXlsxToMarkdown(buffer));
  return {
    name,
    mimeType,
    size: buffer.length,
    data: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}
