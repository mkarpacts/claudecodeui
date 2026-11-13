// server/services/attachments/constants.js
// All limits are hardcoded (no env config) — see design spec.

// Attachment limits and Office types are shared with the client: see shared/attachmentTypes.js.
export {
  MAX_ATTACHMENT_SIZE as MAX_FILE_SIZE,
  MAX_ATTACHMENTS,
  OFFICE,
} from '../../../shared/attachmentTypes.js';

export const MAX_MD_CHARS = 120000;            // ceiling on generated markdown (~30k tokens)
export const XLSX_MAX_ROWS = 5000;             // parse guard against decompression bombs
export const PANDOC_TIMEOUT_MS = 20000;        // docx conversion timeout

export const EMPTY_NOTICE = '_(document contained no extractable text)_';

// Legacy binary formats we explicitly reject.
export const LEGACY_OFFICE_EXTS = new Set(['.doc', '.xls']);

// Persistent folder for every chat attachment (all allowed formats). Override with the
// CLAUDE_UI_INPUTS_DIR env var. The code never creates this folder: it must already
// exist (created by hand on the server), otherwise saving fails with the fs error.
export const DEFAULT_INPUTS_DIR = '/home/node/work/inputs';
