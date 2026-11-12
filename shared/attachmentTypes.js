/**
 * Chat attachment types and limits.
 * Single source of truth for the composer (src/), the upload endpoint (server/index.js)
 * and the delivery of attachments to Claude (server/services/attachments/delivery.js).
 */

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB per file
export const MAX_ATTACHMENTS = 5;                    // files per chat message

export const OFFICE = {
  docx: {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    ext: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
};

/**
 * Allowed MIME type -> its file extensions; the first extension is the canonical one
 * (used when a file name has to be derived from the MIME type).
 * The shape matches react-dropzone's `accept` option.
 */
export const ATTACHMENT_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/pdf': ['.pdf'],
  [OFFICE.docx.mime]: [OFFICE.docx.ext],
  [OFFICE.xlsx.mime]: [OFFICE.xlsx.ext],
};

export const ATTACHMENT_MIME_TYPES = new Set(Object.keys(ATTACHMENT_TYPES));

export const ATTACHMENT_EXTENSIONS = new Set(Object.values(ATTACHMENT_TYPES).flat());
