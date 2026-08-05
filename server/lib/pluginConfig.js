// server/lib/pluginConfig.js
import path from 'path';

export function pluginPathsFromEnv(env) {
  return (env || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function pluginConfigsFromEnv(env) {
  return pluginPathsFromEnv(env).map((p) => ({ type: 'local', path: p }));
}

export function pluginCommandDirs(env) {
  return pluginPathsFromEnv(env).map((p) => path.posix.join(p, 'commands'));
}

export function isPluginCommandPath(commandPath, env) {
  if (!commandPath) return false;

  const resolvedPath = path.resolve(commandPath);

  return pluginCommandDirs(env).some((dir) => {
    const relativePath = path.relative(path.resolve(dir), resolvedPath);
    return relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath);
  });
}
