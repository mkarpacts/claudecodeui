import { promises as fs } from 'fs';
import path from 'path';
import { MAX_ATTACHMENTS } from './constants.js';
import { getInputsDir } from './inputsStore.js';
import { AttachmentError } from './upload.js';

/** Appends the "[Attached files:]" block (one numbered line per entry) to the prompt. */
function withFileNote(command, lines) {
  if (lines.length === 0 || !command || !command.trim()) return command;
  return `${command}\n\n[Attached files:]\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}`;
}

/** Name used in error messages: the given name, else the path's basename, else "unknown". */
function displayName(attachment) {
  if (typeof attachment?.name === 'string' && attachment.name) return attachment.name;
  if (typeof attachment?.path === 'string' && attachment.path) {
    return path.basename(attachment.path) || 'unknown';
  }
  return 'unknown';
}

/** Returns the resolved path of an attachment, or throws an AttachmentError naming the file. */
async function resolveAttachment(attachment, resolvedInputsDir) {
  const fail = (reason) => new AttachmentError(
    `Attachment "${displayName(attachment)}" is not available on the server: ${reason}`,
  );
  const p = attachment?.path;
  if (typeof p !== 'string' || p === '') throw fail('it was not uploaded (no path)');

  const resolved = path.resolve(p);
  if (!resolved.startsWith(resolvedInputsDir + path.sep)) {
    throw fail('it is not inside the inputs folder');
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    throw fail(err?.code === 'ENOENT' ? 'the file does not exist' : (err?.message ?? String(err)));
  }
  if (!stat.isFile()) throw fail('it is not a file');
  return resolved;
}

/**
 * Validates the attachments an SDK query refers to and returns the prompt with the
 * "[Attached files:]" block listing their paths in attachment order.
 *
 * Attachments are already saved in the inputs folder at upload time; this only checks that
 * each path is an existing file inside that folder. It never writes, moves or deletes files.
 * Any problem throws an AttachmentError naming the file (no fallback).
 *
 * @param {string} command - Original user prompt
 * @param {Array<{name?: string, path?: string}>|undefined} attachments
 * @param {{ inputsDir?: string }} [opts] - Test override for the inputs dir (default getInputsDir())
 * @returns {Promise<{ modifiedCommand: string }>}
 */
export async function handleAttachments(command, attachments, opts = {}) {
  if (attachments === undefined || attachments === null) return { modifiedCommand: command };
  if (!Array.isArray(attachments)) {
    throw new AttachmentError('Attachments are malformed: expected a list of files');
  }
  if (attachments.length === 0) return { modifiedCommand: command };
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(`Too many attachments: at most ${MAX_ATTACHMENTS} files per message`);
  }

  const resolvedInputsDir = path.resolve(opts.inputsDir ?? getInputsDir());
  const lines = [];
  for (const attachment of attachments) {
    lines.push(await resolveAttachment(attachment, resolvedInputsDir));
  }
  return { modifiedCommand: withFileNote(command, lines) };
}
