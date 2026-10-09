// server/lib/mcpConfig.js
// Builds the authoritative MCP server list for SDK sessions. Wiki access must go through the
// wiki-mcp sidecar only: any `dokuwiki` entry or wiki /lib/plugins/mcp/ URL from ~/.claude.json is
// dropped, and the sidecar comes solely from CLAUDE_MCP_SERVERS (compose). Invalid env => no wiki.

const WIKI_PLUGIN_PATH = '/lib/plugins/mcp/';

export function isWikiPluginUrl(url) {
  return String(url || '').toLowerCase().includes(WIKI_PLUGIN_PATH);
}

export function isBlockedServer(name, cfg) {
  return String(name).toLowerCase() === 'dokuwiki' || isWikiPluginUrl(cfg?.url);
}

export function parseEnvMcpServers(raw, log = console) {
  if (!raw || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.error('[MCP] CLAUDE_MCP_SERVERS is not valid JSON; no servers taken from it');
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log.error('[MCP] CLAUDE_MCP_SERVERS must be a JSON object');
    return {};
  }
  const out = {};
  for (const [name, cfg] of Object.entries(parsed)) {
    const valid = cfg && (cfg.type === 'http' || cfg.type === 'sse')
      && typeof cfg.url === 'string' && /^https?:\/\//.test(cfg.url) && !isWikiPluginUrl(cfg.url);
    if (valid) out[name] = { ...cfg };
    else log.error(`[MCP] CLAUDE_MCP_SERVERS: skipping invalid entry "${name}"`);
  }
  return out;
}

export function buildMcpServers({ userConfig, cwd, envRaw, log = console }) {
  const servers = {};
  const addPool = (pool) => {
    if (!pool || typeof pool !== 'object') return;
    for (const [name, cfg] of Object.entries(pool)) {
      if (isBlockedServer(name, cfg)) {
        log.warn(`[MCP] ignoring "${name}" from ~/.claude.json (wiki access only via wiki-mcp)`);
        continue;
      }
      servers[name] = cfg;
    }
  };
  addPool(userConfig?.mcpServers);
  if (cwd) {
    addPool(userConfig?.projects?.[cwd]?.mcpServers);
    addPool(userConfig?.claudeProjects?.[cwd]?.mcpServers);
  }
  return { ...servers, ...parseEnvMcpServers(envRaw, log) };
}

export function applyMcpOptions(sdkOptions, servers) {
  sdkOptions.strictMcpConfig = true;
  sdkOptions.mcpServers = servers || {};
}

// Scopes whose servers reach SDK sessions. 'project' lives in .mcp.json, which strictMcpConfig ignores,
// so the UI must not report such a server as added.
export function isLoadableScope(scope) {
  return (scope ?? 'user') !== 'project';
}

// Express middleware for the /cli/add* routes: refuse scopes whose servers would never load.
export function rejectUnloadableScope(req, res, next) {
  if (isLoadableScope(req.body?.scope)) return next();
  return res.status(400).json({
    error: 'Project scope (.mcp.json) is not loaded in SDK sessions (strictMcpConfig); use user or local scope'
  });
}
