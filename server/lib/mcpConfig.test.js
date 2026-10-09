// server/lib/mcpConfig.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMcpOptions, buildMcpServers, isBlockedServer, isLoadableScope, parseEnvMcpServers, rejectUnloadableScope } from './mcpConfig.js';

const quiet = { warn() {}, error() {} };
const SIDECAR = { type: 'http', url: 'http://cts-wiki-mcp:8000/mcp' };
const ENV = JSON.stringify({ dokuwiki: SIDECAR });

test('isBlockedServer: dokuwiki name or wiki mcp.php url', () => {
  assert.equal(isBlockedServer('dokuwiki', { url: 'http://x' }), true);
  assert.equal(isBlockedServer('DokuWiki', {}), true);
  assert.equal(isBlockedServer('wiki2', { url: 'https://wiki.cts-group.local/lib/plugins/mcp/mcp.php' }), true);
  assert.equal(isBlockedServer('wiki3', { url: 'https://wiki.cts-group.local/Lib/Plugins/MCP/mcp.php' }), true);
  assert.equal(isBlockedServer('mssql', { url: 'http://cts-mssql-mcp:8000/mcp' }), false);
});

test('buildMcpServers: user dokuwiki dropped, env dokuwiki added, others kept', () => {
  const userConfig = {
    mcpServers: {
      dokuwiki: { type: 'http', url: 'https://wiki.cts-group.local/lib/plugins/mcp/mcp.php' },
      mssql: { type: 'http', url: 'http://cts-mssql-mcp:8000/mcp' },
    },
  };
  assert.deepEqual(buildMcpServers({ userConfig, envRaw: ENV, log: quiet }), {
    mssql: { type: 'http', url: 'http://cts-mssql-mcp:8000/mcp' },
    dokuwiki: SIDECAR,
  });
});

test('buildMcpServers: invalid env JSON is fail-closed (no dokuwiki at all)', () => {
  const userConfig = { mcpServers: { dokuwiki: { type: 'http', url: 'https://wiki/lib/plugins/mcp/mcp.php' } } };
  assert.deepEqual(buildMcpServers({ userConfig, envRaw: '{not json', log: quiet }), {});
});

test('buildMcpServers: project servers from projects[cwd] and claudeProjects[cwd]', () => {
  const userConfig = {
    projects: { '/w': { mcpServers: { a: { type: 'http', url: 'http://a' }, wiki: { url: 'https://w/lib/plugins/mcp/mcp.php' } } } },
    claudeProjects: { '/w': { mcpServers: { b: { type: 'http', url: 'http://b' } } } },
  };
  assert.deepEqual(Object.keys(buildMcpServers({ userConfig, cwd: '/w', envRaw: '', log: quiet })).sort(), ['a', 'b']);
});

test('buildMcpServers: no user config file', () => {
  assert.deepEqual(buildMcpServers({ userConfig: null, envRaw: ENV, log: quiet }), { dokuwiki: SIDECAR });
});

test('parseEnvMcpServers: skips invalid entries and the wiki mcp.php endpoint', () => {
  const raw = JSON.stringify({
    ok: SIDECAR,
    noUrl: { type: 'http' },
    stdio: { type: 'stdio', command: 'x' },
    ftp: { type: 'http', url: 'ftp://x' },
    hole: { type: 'http', url: 'https://wiki.cts-group.local/lib/plugins/mcp/mcp.php' },
    holeUpper: { type: 'http', url: 'https://wiki.cts-group.local/LIB/plugins/mcp/mcp.php' },
  });
  assert.deepEqual(parseEnvMcpServers(raw, quiet), { ok: SIDECAR });
  assert.deepEqual(parseEnvMcpServers('[]', quiet), {});
  assert.deepEqual(parseEnvMcpServers(undefined, quiet), {});
});

test('applyMcpOptions: always strict, servers object even when empty', () => {
  const opts = {};
  applyMcpOptions(opts, {});
  assert.deepEqual(opts, { strictMcpConfig: true, mcpServers: {} });
  applyMcpOptions(opts, { dokuwiki: SIDECAR });
  assert.deepEqual(opts.mcpServers, { dokuwiki: SIDECAR });
});

test('parseEnvMcpServers: keeps the per-server timeout (ms) for the SDK', () => {
  const raw = JSON.stringify({ dokuwiki: { ...SIDECAR, timeout: 180000 } });
  assert.deepEqual(parseEnvMcpServers(raw, quiet), { dokuwiki: { ...SIDECAR, timeout: 180000 } });
});

test('isLoadableScope: project (.mcp.json) is not loaded under strictMcpConfig', () => {
  assert.equal(isLoadableScope('user'), true);
  assert.equal(isLoadableScope('local'), true);
  assert.equal(isLoadableScope(undefined), true);
  assert.equal(isLoadableScope('project'), false);
});

test('rejectUnloadableScope: 400 for project scope, next() otherwise', () => {
  const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  let passed = 0;
  const res = fakeRes();
  rejectUnloadableScope({ body: { scope: 'project' } }, res, () => { passed += 1; });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /strictMcpConfig/);
  for (const body of [{ scope: 'user' }, { scope: 'local' }, {}, undefined]) rejectUnloadableScope({ body }, fakeRes(), () => { passed += 1; });
  assert.equal(passed, 4);
});
