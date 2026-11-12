import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ATTACHMENT_EXTENSIONS, ATTACHMENT_TYPES } from '../../../shared/attachmentTypes.js';
import { MAX_ATTACHMENTS, MAX_FILE_SIZE, OFFICE } from './constants.js';
import { getInputsDir, saveToInputs } from './inputsStore.js';

// Extensions whose originals are kept in the persistent inputs dir.
const OFFICE_EXTENSIONS = new Set([OFFICE.docx.ext, OFFICE.xlsx.ext]);

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
 * @param {string|null} mimeType - MIME type extracted from data URI (fallback for extension)
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

/**
 * True when the ORIGINAL attachment name ends in .docx / .xlsx, case-insensitively.
 * A name that only gets an office extension from its MIME type (e.g. "x.exe" sent as
 * OOXML) does not count.
 */
function hasOfficeName(rawName) {
  return OFFICE_EXTENSIONS.has(path.extname(cleanName(rawName)).toLowerCase());
}

/** Appends the "[Attached files:]" block (one numbered line per entry) to the prompt. */
function withFileNote(command, lines) {
  if (lines.length === 0 || !command || !command.trim()) return command;
  return `${command}\n\n[Attached files:]\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}`;
}

/**
 * Handles file attachment processing for SDK queries and returns the prompt with the
 * "[Attached files:]" block listing every delivered file in attachment order.
 *
 * - .docx/.xlsx (by the original name's extension) are saved as originals into the
 *   persistent inputs dir via saveToInputs and are never cleaned up. When that save fails
 *   (e.g. the dir is missing) the file goes to the temp dir instead and its prompt line
 *   says it is a temporary copy.
 * - Every other attachment is written to a per-message temp dir (created lazily, only when
 *   a file needs it) and deleted later by cleanupTempFiles.
 * - Only the first MAX_ATTACHMENTS attachments are processed (the upload endpoint has the
 *   same cap, but a WebSocket client can bypass it); an attachment whose decoded size
 *   exceeds MAX_FILE_SIZE is skipped. Each attachment is handled on its own, so one
 *   failure does not drop the others.
 *
 * @param {string} command - Original user prompt
 * @param {Array<{name?: string, data?: string}>} attachments - Attachments with data-URL base64 data
 * @param {{ inputsDir?: string, now?: Date }} [opts] - Test overrides: inputs dir
 *   (default getInputsDir()) and the clock used for collision prefixes
 * @returns {Promise<{ modifiedCommand: string, tempDir: string|null }>} tempDir holds ONLY
 *   temp files (never inputs originals) and is null when no temp file was needed.
 */
export async function handleAttachments(command, attachments, opts = {}) {
  const listedLines = [];
  let tempDir = null;
  let resolvedTempDir = null;

  if (!attachments || attachments.length === 0) {
    return { modifiedCommand: command, tempDir };
  }

  const inputsDir = opts.inputsDir ?? getInputsDir();
  const usedNames = new Set();

  // Writes one file into the (lazily created) temp dir; returns its path, or null if blocked.
  const writeTemp = async (name, buffer) => {
    if (!tempDir) {
      await fs.mkdir(path.join(os.tmpdir(), 'claude-ui-attachments'), { recursive: true });
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-attachments', path.sep));
      resolvedTempDir = path.resolve(tempDir);
    }

    // Handle duplicate names
    let filename = name;
    if (usedNames.has(filename)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 1;
      while (usedNames.has(`${base}_${counter}${ext}`)) counter++;
      filename = `${base}_${counter}${ext}`;
    }
    usedNames.add(filename);

    const filepath = path.join(tempDir, filename);

    // Path traversal guard: final check
    if (!path.resolve(filepath).startsWith(resolvedTempDir + path.sep)) {
      console.error(`Path traversal blocked: ${filename}`);
      return null;
    }

    await fs.writeFile(filepath, buffer);
    return filepath;
  };

  // Stores one office original in the inputs dir; falls back to a temp copy when that fails.
  // Returns the prompt line for the file, or null if it could not be delivered at all.
  const deliverOffice = async (filename, buffer) => {
    try {
      return await saveToInputs({ dir: inputsDir, filename, buffer, now: opts.now });
    } catch (saveError) {
      console.error(
        `Could not save "${filename}" to the inputs dir ${inputsDir}; using a temporary copy instead:`,
        saveError,
      );
      const tempPath = await writeTemp(filename, buffer);
      return tempPath
        && `${tempPath} (temporary copy: could not be saved to ${inputsDir}; it is deleted after this reply)`;
    }
  };

  try {
    if (attachments.length > MAX_ATTACHMENTS) {
      const ignored = attachments.slice(MAX_ATTACHMENTS).map((a) => `"${a?.name}"`).join(', ');
      console.error(`Only the first ${MAX_ATTACHMENTS} attachments are processed; ignoring ${ignored}`);
    }

    for (const attachment of attachments.slice(0, MAX_ATTACHMENTS)) {
      try {
        const matches = typeof attachment?.data === 'string'
          ? attachment.data.match(/^data:([^;]+);base64,(.+)$/)
          : null;
        if (!matches) {
          console.error(`Invalid attachment data format for "${attachment?.name}"`);
          continue;
        }

        const [, mimeType, base64Data] = matches;

        // Sanitize filename -- skip if no safe name possible
        const filename = safeFilename(attachment.name, mimeType);
        if (!filename) {
          console.error(`Skipping attachment: cannot determine safe filename for "${attachment.name}"`);
          continue;
        }

        const size = Buffer.byteLength(base64Data, 'base64');
        if (size > MAX_FILE_SIZE) {
          console.error(`Skipping attachment "${filename}": ${size} bytes exceeds the ${MAX_FILE_SIZE}-byte limit`);
          continue;
        }
        const buffer = Buffer.from(base64Data, 'base64');

        const line = hasOfficeName(attachment.name)
          ? await deliverOffice(filename, buffer)
          : await writeTemp(filename, buffer);
        if (line) listedLines.push(line);
      } catch (attachmentError) {
        console.error(`Error processing attachment "${attachment?.name}" for SDK:`, attachmentError);
      }
    }
  } catch (error) {
    // Malformed `attachments` (e.g. not an array): keep whatever was delivered so far.
    console.error('Error processing attachments for SDK:', error);
  }

  return { modifiedCommand: withFileNote(command, listedLines), tempDir };
}

/**
 * Removes the per-message temp dir together with every temp attachment file inside it.
 * @param {string|null} tempDir - Temp directory returned by handleAttachments
 */
export async function cleanupTempFiles(tempDir) {
  if (!tempDir) return;
  await fs.rm(tempDir, { recursive: true, force: true }).catch((err) =>
    console.error(`Failed to delete temp directory ${tempDir}:`, err),
  );
}
