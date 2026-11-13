// Path validation for read-only endpoints. Besides the project root, files in a
// few fixed folders (user inputs, plans) may be read. Write endpoints keep using
// validatePathInProject and never accept these extra folders.
import fs from 'node:fs/promises';
import path from 'node:path';

export const READABLE_EXTRA_ROOTS = ['/home/node/work', '/home/node/.claude/plans'];

const isInside = (child, parent) => child.startsWith(parent + path.sep);

export async function validateReadablePath(projectRoot, targetPath, extraRoots = READABLE_EXTRA_ROOTS) {
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(projectRoot, targetPath);

  if (isInside(resolved, path.resolve(projectRoot))) {
    return { valid: true, resolved };
  }

  for (const root of extraRoots) {
    if (!isInside(resolved, path.resolve(root))) continue;

    // A missing or unreadable root is simply not an allowed folder on this machine
    const realRoot = await fs.realpath(root).catch(() => null);
    if (!realRoot) continue;

    const real = await fs.realpath(resolved).catch((err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (!real) {
      return { valid: false, status: 404, error: 'File not found' };
    }

    if (isInside(real, realRoot)) {
      return { valid: true, resolved: real };
    }
  }

  return { valid: false, status: 403, error: 'Path is outside the project and the allowed folders' };
}
