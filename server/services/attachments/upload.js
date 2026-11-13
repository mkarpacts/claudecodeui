// server/services/attachments/upload.js
// Stores uploaded chat attachments in the persistent inputs folder, with a correct
// UTF-8 (NFC) name. No fallback location: a failed save is reported to the user.
import path from 'node:path';
import multer from 'multer';
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_TYPES,
} from '../../../shared/attachmentTypes.js';
import { LEGACY_OFFICE_EXTS, MAX_ATTACHMENTS, MAX_FILE_SIZE } from './constants.js';
import { decodeUploadName } from './index.js';
import { getInputsDir, saveToInputs } from './inputsStore.js';

/** Expected, user-visible failure (the message names the file). */
export class AttachmentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AttachmentError';
  }
}

// Allowed MIME type -> canonical extension, for names that need one derived.
const MIME_TO_EXT = Object.fromEntries(
  Object.entries(ATTACHMENT_TYPES).map(([mime, exts]) => [mime, exts[0]]),
);

/** Client-supplied name without directory components and null bytes ('' when not a string). */
function cleanName(rawName) {
  return (rawName && typeof rawName === 'string')
    ? path.basename(rawName).replace(/\0/g, '')
    : '';
}

/**
 * Sanitize an attachment filename for safe filesystem writes.
 * Strips path components, null bytes, and validates extension against allowlist.
 * Returns null if a safe filename cannot be determined -- caller must skip the attachment.
 * @param {string} rawName - Original filename from client
 * @param {string|null} mimeType - MIME type (fallback for extension)
 * @returns {string|null} Safe filename, or null to skip
 */
export function safeFilename(rawName, mimeType) {
  const name = cleanName(rawName);
  const usable = name !== '' && name !== '.' && name !== '..';

  if (usable && ATTACHMENT_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    return name;
  }

  // Filename missing or has disallowed extension -- try to derive from MIME
  const derivedExt = mimeType ? MIME_TO_EXT[mimeType] : null;
  if (!derivedExt) {
    return null; // skip: cannot determine safe extension
  }

  // Build fallback name: use base of original name (without bad ext) or generic
  const base = usable ? path.basename(name, path.extname(name)) : 'file';
  return `${base}${derivedExt}`;
}

/** Name to store a multipart upload under: latin1 mojibake repaired, NFC, sanitized. */
export function toStoredName(originalname, mimeType) {
  return safeFilename(decodeUploadName(originalname).normalize('NFC'), mimeType);
}

/** Human-readable reason for a failed save (shown to the user after the file name). */
export function saveFailureReason(err, dir) {
  switch (err?.code) {
    case 'ENOENT': return `folder ${dir} does not exist`;
    case 'EACCES':
    case 'EPERM': return `no write permission for ${dir}`;
    case 'ENOSPC': return 'no space left on the server disk';
    case 'ENAMETOOLONG': return 'file name is too long; rename the file and try again';
    default: return err?.message ?? String(err);
  }
}

/**
 * Saves the files one by one, in order, into the inputs folder. Stops at the first
 * failure with an AttachmentError; files already saved stay.
 * @param {Array<{originalname: string, mimetype: string, buffer: Buffer}>} files
 * @param {{dir?: string, now?: Date}} [opts]
 * @returns {Promise<Array<{name: string, mimeType: string, size: number, path: string}>>}
 */
export async function storeAttachments(files, { dir = getInputsDir(), now } = {}) {
  const stored = [];
  for (const file of files) {
    const filename = toStoredName(file.originalname, file.mimetype);
    if (!filename) {
      const shown = decodeUploadName(file.originalname).normalize('NFC');
      throw new AttachmentError(`Unsupported file "${shown}"`);
    }
    let savedPath;
    try {
      savedPath = await saveToInputs({ dir, filename, buffer: file.buffer, now });
    } catch (err) {
      throw new AttachmentError(
        `Could not save "${filename}": ${saveFailureReason(err, dir)}`,
        { cause: err },
      );
    }
    stored.push({
      name: path.basename(savedPath),
      mimeType: file.mimetype,
      size: file.buffer.length,
      path: savedPath,
    });
  }
  return stored;
}

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (LEGACY_OFFICE_EXTS.has(ext)) {
    return cb(new Error('Legacy .doc/.xls is not supported. Re-save as .docx/.xlsx.'));
  }
  // Accept by MIME OR extension -- browser MIME for OOXML is unreliable.
  if (ATTACHMENT_MIME_TYPES.has(file.mimetype) || ATTACHMENT_EXTENSIONS.has(ext)) {
    return cb(null, true);
  }
  cb(new Error('Invalid file type. Allowed: images, txt, md, csv, pdf, docx, xlsx.'));
}

/**
 * Express handler for POST .../upload-attachments: multipart in memory, then every file
 * is saved to the inputs folder. 200 {attachments}, 400 {error} for expected failures.
 * @param {{dir?: string}} [opts] dir is resolved per request (default: getInputsDir()).
 */
export function createUploadAttachmentsHandler({ dir } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_ATTACHMENTS },
  }).array('attachments', MAX_ATTACHMENTS);

  return (req, res) => {
    upload(req, res, async (err) => {
      if (err) {
        console.warn(`Attachment upload rejected (400): ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      if (!req.files || req.files.length === 0) {
        console.warn('Attachment upload rejected (400): No files provided');
        return res.status(400).json({ error: 'No files provided' });
      }
      try {
        const attachments = await storeAttachments(req.files, { dir: dir ?? getInputsDir() });
        res.json({ attachments });
      } catch (error) {
        if (error instanceof AttachmentError) {
          console.warn(`Attachment upload rejected (400): ${error.message}`);
          return res.status(400).json({ error: error.message });
        }
        console.error('Error storing attachments:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}
