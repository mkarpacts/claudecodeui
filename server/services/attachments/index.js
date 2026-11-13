// server/services/attachments/index.js

/**
 * multer/busboy decodes multipart filenames as latin1, so UTF-8 names arrive mangled.
 * Re-decode when every char fits a byte and the bytes form valid UTF-8; otherwise keep as is.
 */
export function decodeUploadName(name) {
  if (typeof name !== 'string' || /[^\x00-\xff]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}
