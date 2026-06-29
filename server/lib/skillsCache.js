// server/lib/skillsCache.js
import { createHash } from 'crypto';

export function computeVersion({ pluginsEnv, pluginMtimes, skillsDirMtime }) {
  const payload = JSON.stringify({
    pluginsEnv: pluginsEnv || '',
    pluginMtimes: pluginMtimes || [],
    skillsDirMtime: skillsDirMtime || 0,
  });
  return createHash('sha1').update(payload).digest('hex');
}

// Plugin skills are process-global (from CLAUDE_PLUGINS + ~/.claude/skills), not per-project,
// so a single version-keyed slot is enough — no cwd dimension.
export function makeSkillsCache() {
  let entry = null; // { version, skills }
  return {
    get(version) {
      return entry && entry.version === version ? entry.skills : null;
    },
    set(version, skills) {
      entry = { version, skills };
    },
  };
}

export const skillsCache = makeSkillsCache();
