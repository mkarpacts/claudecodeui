// server/lib/skillsVersion.js
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pluginPathsFromEnv } from './pluginConfig.js';
import { computeVersion } from './skillsCache.js';

function safeMtime(p) {
  try { return Math.floor(fs.statSync(p).mtimeMs); } catch { return 0; }
}

export function currentSkillsVersion(env = process.env.CLAUDE_PLUGINS) {
  // pluginMtimes order follows CLAUDE_PLUGINS (deterministic env order), so the version
  // hash is stable across calls; do NOT reorder these independently.
  const pluginMtimes = pluginPathsFromEnv(env).map((p) => safeMtime(p));
  const skillsDirMtime = safeMtime(path.join(os.homedir(), '.claude', 'skills'));
  return computeVersion({ pluginsEnv: env || '', pluginMtimes, skillsDirMtime });
}
