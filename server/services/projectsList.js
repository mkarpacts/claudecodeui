// Projects list without any JSONL reads: directories + manual config + SQL counts.
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { loadProjectConfig, generateDisplayName, extractProjectDirectory } from '../projects.js';

export async function listProjectsLight({
  sessionsMetaDb,
  userId,
  projectsRoot = path.join(os.homedir(), '.claude', 'projects'),
  config = null,
}) {
  if (!config) config = await loadProjectConfig();
  const counts = sessionsMetaDb.countsByProjectForUser(userId);
  const cwds = sessionsMetaDb.latestCwdByProject();

  let dirNames = [];
  try {
    dirNames = (await fs.readdir(projectsRoot, { withFileTypes: true }))
      .filter(e => e.isDirectory()).map(e => e.name);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }

  const buildProject = (name, fullPath, displayName) => {
    const c = counts.get(name);
    return {
      name,
      path: fullPath,
      fullPath,
      displayName,
      isCustomName: Boolean(config[name]?.displayName),
      isManuallyAdded: Boolean(config[name]?.manuallyAdded),
      sessions: [], // sessions load lazily on project expand
      sessionMeta: { total: c?.total || 0, lastActivity: c?.lastActivity || null },
      cursorSessions: [], codexSessions: [], geminiSessions: [],
    };
  };

  // extractProjectDirectory owns the resolution precedence (config -> sessions_meta
  // -> newest-file probe -> lossy decode); preloaded config/cwd avoid per-project I/O.
  const resolveOne = async (name) => {
    const fullPath = await extractProjectDirectory(name, { config, latestCwd: cwds.get(name) ?? null });
    return buildProject(name, fullPath, config[name]?.displayName || await generateDisplayName(name, fullPath));
  };

  // Directory-backed projects first; remember their resolved paths for dedup below.
  const dirSet = new Set(dirNames);
  const projects = await Promise.all(dirNames.map(resolveOne));
  const seenPaths = new Set(projects.map(p => path.resolve(p.fullPath)));

  // Manually added config entries. addProjectManually now uses the canonical CLI
  // encoding, but legacy config may hold a twin of an existing directory under a
  // different name — dedup by resolved path, like the old getProjects did.
  const manualNames = Object.entries(config)
    .filter(([name, cfg]) => cfg.manuallyAdded && !dirSet.has(name))
    .filter(([, cfg]) => !(cfg.originalPath && seenPaths.has(path.resolve(cfg.originalPath))))
    .map(([name]) => name);
  projects.push(...await Promise.all(manualNames.map(resolveOne)));

  return projects;
}
