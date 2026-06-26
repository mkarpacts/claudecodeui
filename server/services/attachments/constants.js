// server/services/attachments/constants.js
// All limits are hardcoded (no env config) — see design spec.

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per uploaded file
export const MAX_MD_CHARS = 120000;            // ceiling on generated markdown (~30k tokens)
export const XLSX_MAX_ROWS = 5000;             // parse guard against decompression bombs
export const PANDOC_TIMEOUT_MS = 20000;        // docx conversion timeout

export const EMPTY_NOTICE = '_(document contained no extractable text)_';

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

// Legacy binary formats we explicitly reject.
export const LEGACY_OFFICE_EXTS = new Set(['.doc', '.xls']);
