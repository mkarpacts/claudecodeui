// server/services/attachments/index.js
import { extname } from 'node:path';
import { OFFICE } from './constants.js';

/** Returns 'docx' | 'xlsx' | null. Extension wins; MIME is a fallback (browser MIME is unreliable). */
export function detectKind(name, mimeType) {
  const ext = extname(name || '').toLowerCase();
  if (ext === OFFICE.docx.ext || mimeType === OFFICE.docx.mime) return 'docx';
  if (ext === OFFICE.xlsx.ext || mimeType === OFFICE.xlsx.mime) return 'xlsx';
  return null;
}

/**
 * multer/busboy decodes multipart filenames as latin1, so UTF-8 names arrive mangled.
 * Re-decode when every char fits a byte and the bytes form valid UTF-8; otherwise keep as is.
 */
export function decodeUploadName(name) {
  if (typeof name !== 'string' || /[^\x00-\xff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/**
 * Normalize an uploaded attachment for the chat pipeline.
 * No conversion: every file (Office included) passes through as the original bytes in a
 * base64 data URL. Office files get the canonical MIME type, because browsers often send
 * an empty or generic one, which breaks the `^data:([^;]+);base64,` parsing downstream.
 */
export async function processAttachment({ buffer, name, mimeType }) {
  const kind = detectKind(name, mimeType);
  const mime = kind ? OFFICE[kind].mime : mimeType;
  return {
    name,
    mimeType: mime,
    size: buffer.length,
    data: `data:${mime};base64,${buffer.toString('base64')}`,
  };
}
