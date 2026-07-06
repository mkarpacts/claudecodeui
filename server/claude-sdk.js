/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled
} from './services/notification-orchestrator.js';
import { claudeAdapter } from './providers/claude/adapter.js';
import { createNormalizedMessage } from './providers/types.js';
import { usageDb, sessionOwnershipDb, sessionsMetaDb, sessionNamesDb } from './database/db.js';
import { truncateTitle } from './services/sessionsLiveness.js';
import { encodeProjectName, sessionFilePath } from './database/sessionsMeta.js';
import { broadcastToUser } from './lib/wsHub.js';
import { pluginConfigsFromEnv } from './lib/pluginConfig.js';
import { skillsCache } from './lib/skillsCache.js';
import { currentSkillsVersion } from './lib/skillsVersion.js';
import { reattachUserSessions } from './lib/reattachSessions.js';

const activeSessions = new Map();
const pendingToolApprovals = new Map();

const TOOL_APPROVAL_TIMEOUT_MS = parseInt(process.env.CLAUDE_TOOL_APPROVAL_TIMEOUT_MS, 10) || 55000;

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion']);

const FIRST_MESSAGE_TIMEOUT_MS = parseInt(process.env.CLAUDE_FIRST_MESSAGE_TIMEOUT_MS, 10) || 15000;

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function waitForToolApproval(requestId, options = {}) {
  const { timeoutMs = TOOL_APPROVAL_TIMEOUT_MS, signal, onCancel, metadata } = options;

  return new Promise(resolve => {
    let settled = false;

    const finalize = (decision) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(decision);
    };

    let timeout;

    const cleanup = () => {
      pendingToolApprovals.delete(requestId);
      if (timeout) clearTimeout(timeout);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    // timeoutMs 0 = wait indefinitely (interactive tools)
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        onCancel?.('timeout');
        finalize(null);
      }, timeoutMs);
    }

    const abortHandler = () => {
      onCancel?.('cancelled');
      finalize({ cancelled: true });
    };

    if (signal) {
      if (signal.aborted) {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const resolver = (decision) => {
      finalize(decision);
    };
    // Attach metadata for getPendingApprovalsForSession lookup
    if (metadata) {
      Object.assign(resolver, metadata);
    }
    pendingToolApprovals.set(requestId, resolver);
  });
}

function resolveToolApproval(requestId, decision) {
  const resolver = pendingToolApprovals.get(requestId);
  if (resolver) {
    resolver(decision);
  }
}

// Match stored permission entries against a tool + input combo.
// This only supports exact tool names and the Bash(command:*) shorthand
// used by the UI; it intentionally does not implement full glob semantics,
// introduced to stay consistent with the UI's "Allow rule" format.
function matchesToolPermission(entry, toolName, input) {
  if (!entry || !toolName) {
    return false;
  }

  if (entry === toolName) {
    return true;
  }

  const bashMatch = entry.match(/^Bash\((.+):\*\)$/);
  if (toolName === 'Bash' && bashMatch) {
    const allowedPrefix = bashMatch[1];
    let command = '';

    if (typeof input === 'string') {
      command = input.trim();
    } else if (input && typeof input === 'object' && typeof input.command === 'string') {
      command = input.command.trim();
    }

    if (!command) {
      return false;
    }

    return command.startsWith(allowedPrefix);
  }

  return false;
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode } = options;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;
  // Model logged at query start below

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Load external plugins (skills + commands + hooks) from CLAUDE_PLUGINS (comma-separated plugin roots)
  const pluginConfigs = pluginConfigsFromEnv(process.env.CLAUDE_PLUGINS);
  if (pluginConfigs.length) {
    sdkOptions.plugins = pluginConfigs;
  }

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Waits for the first message from an async generator with a timeout.
 * Returns the message or throws on timeout.
 */
function waitForFirstMessage(asyncIterator, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`SDK did not produce a message within ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    asyncIterator.next().then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    );
  });
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempAttachmentPaths - Temp attachment file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempAttachmentPaths = [], tempDir = null, writer = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempAttachmentPaths,
    tempDir,
    writer
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Use configured context window budget from environment (default 160000)
  // This is the user's budget limit, not the model's context window
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;

  // Token calc logged via token-budget WS event

  return {
    used: totalUsed,
    total: contextWindow
  };
}

const SAFE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.txt', '.md', '.csv', '.pdf',
]);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg',
  'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv',
  'application/pdf': '.pdf',
};

/**
 * Sanitize an attachment filename for safe filesystem writes.
 * Strips path components, null bytes, and validates extension against allowlist.
 * Returns null if a safe filename cannot be determined -- caller must skip the attachment.
 * @param {string} rawName - Original filename from client
 * @param {string|null} mimeType - MIME type extracted from data URI (fallback for extension)
 * @returns {string|null} Safe filename, or null to skip
 */
function safeFilename(rawName, mimeType) {
  // Strip directory traversal and null bytes
  let name = (rawName && typeof rawName === 'string')
    ? path.basename(rawName).replace(/\0/g, '')
    : '';

  // Validate extension from filename
  const ext = name ? path.extname(name).toLowerCase() : '';

  if (name && name !== '.' && name !== '..' && SAFE_EXTENSIONS.has(ext)) {
    return name;
  }

  // Filename missing or has disallowed extension -- try to derive from MIME
  const derivedExt = mimeType ? MIME_TO_EXT[mimeType] : null;
  if (!derivedExt) {
    return null; // skip: cannot determine safe extension
  }

  // Build fallback name: use base of original name (without bad ext) or generic
  const base = (name && name !== '.' && name !== '..')
    ? path.basename(name, path.extname(name))
    : 'file';
  return `${base}${derivedExt}`;
}

/**
 * Handles file attachment processing for SDK queries.
 * Saves base64 attachments to temporary files and returns modified prompt with file paths.
 * @param {string} command - Original user prompt
 * @param {Array} attachments - Array of attachment objects with base64 data
 * @returns {Promise<Object>} Object with modifiedCommand, tempAttachmentPaths, tempDir
 */
async function handleAttachments(command, attachments) {
  const tempAttachmentPaths = [];
  let tempDir = null;

  if (!attachments || attachments.length === 0) {
    return { modifiedCommand: command, tempAttachmentPaths, tempDir };
  }

  try {
    await fs.mkdir(path.join(os.tmpdir(), 'claude-ui-attachments'), { recursive: true });
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-attachments', path.sep));

    const usedNames = new Set();
    const resolvedTempDir = path.resolve(tempDir);

    for (const [index, attachment] of attachments.entries()) {
      const matches = attachment.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid attachment data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;

      // Sanitize filename -- skip if no safe name possible
      let filename = safeFilename(attachment.name, mimeType);
      if (!filename) {
        console.error(`Skipping attachment: cannot determine safe filename for "${attachment.name}"`);
        continue;
      }

      // Handle duplicate names
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
        continue;
      }

      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempAttachmentPaths.push(filepath);
    }

    let modifiedCommand = command;
    if (tempAttachmentPaths.length > 0 && command && command.trim()) {
      const fileNote = `\n\n[Attached files:]\n${tempAttachmentPaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + fileNote;
    }

    return { modifiedCommand, tempAttachmentPaths, tempDir };
  } catch (error) {
    console.error('Error processing attachments for SDK:', error);
    return { modifiedCommand: command, tempAttachmentPaths, tempDir };
  }
}

/**
 * Cleans up temporary attachment files
 * @param {Array<string>} tempPaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempPaths, tempDir) {
  if (!tempPaths || tempPaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const filePath of tempPaths) {
      await fs.unlink(filePath).catch(err =>
        console.error(`Failed to delete temp file ${filePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    // Temp files cleaned
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      // No config file
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      // Global MCP servers loaded
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        // Project MCP servers merged
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      return null;
    }
    return mcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, sessionSummary } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempAttachmentPaths = [];
  let tempDir = null;

  const emitNotification = (event) => {
    notifyUserIfEnabled({
      userId: ws?.userId || null,
      writer: ws,
      event
    });
  };

  const queryStartTime = Date.now();
  const logPrefix = `[SDK:${sessionId || 'NEW'}]`;

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpLoadStart = Date.now();
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
      const mcpNames = Object.keys(mcpServers);
      console.log(`${logPrefix} MCP servers loaded (${Date.now() - mcpLoadStart}ms): [${mcpNames.join(', ')}]`);
    } else {
      console.log(`${logPrefix} No MCP servers configured`);
    }

    // Handle attachments - save to temp files and modify prompt
    const attachmentResult = await handleAttachments(command, options.attachments);
    const finalCommand = attachmentResult.modifiedCommand;
    const queryText = typeof finalCommand === 'string'
      ? finalCommand.replace(/\s+/g, ' ').trim()
      : null;
    tempAttachmentPaths = attachmentResult.tempAttachmentPaths;
    tempDir = attachmentResult.tempDir;

    sdkOptions.hooks = {
      Notification: [{
        matcher: '',
        hooks: [async (input) => {
          const message = typeof input?.message === 'string' ? input.message : 'Claude requires your attention.';
          emitNotification(createNotificationEvent({
            provider: 'claude',
            sessionId: capturedSessionId || sessionId || null,
            kind: 'action_required',
            code: 'agent.notification',
            meta: { message, sessionName: sessionSummary },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `claude:hook:notification:${capturedSessionId || sessionId || 'none'}:${message}`
          }));
          return {};
        }]
      }]
    };

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions') {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send(createNormalizedMessage({ kind: 'permission_request', requestId, toolName, input, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
      emitNotification(createNotificationEvent({
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName, sessionName: sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `claude:permission:${capturedSessionId || sessionId || 'none'}:${requestId}`
      }));

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction ? 0 : undefined,
        signal: context?.signal,
        metadata: {
          _sessionId: capturedSessionId || sessionId || null,
          _toolName: toolName,
          _input: input,
          _receivedAt: new Date(),
        },
        onCancel: (reason) => {
          ws.send(createNormalizedMessage({ kind: 'permission_cancelled', requestId, reason, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    // Helper: create a query instance, falling back to no-hooks if registration fails.
    const createQueryInstance = () => {
      try {
        return query({ prompt: finalCommand, options: sdkOptions });
      } catch (hookError) {
        console.warn(`${logPrefix} Hook registration failed, retrying without hooks:`, hookError?.message || hookError);
        delete sdkOptions.hooks;
        return query({ prompt: finalCommand, options: sdkOptions });
      }
    };

    console.log(`${logPrefix} Creating query instance (cwd: ${options.cwd || 'none'}, permissionMode: ${sdkOptions.permissionMode || 'default'})`);
    const queryCreateStart = Date.now();
    let queryInstance = createQueryInstance();

    // Cache the runtime skill list once per session (cheap — plugins already loaded here).
    // Single source of truth for the /-menu skills. Fire-and-forget + try/catch:
    // a supportedCommands() failure must never break the chat — it only leaves the cache empty.
    (async () => {
      try {
        if (typeof queryInstance.supportedCommands === 'function') {
          const skills = await queryInstance.supportedCommands();
          skillsCache.set(currentSkillsVersion(), skills);
          console.log(`${logPrefix} Cached ${skills.length} runtime skills/commands`);
        }
      } catch (e) {
        console.warn(`${logPrefix} supportedCommands() failed:`, e?.message || e);
      }
    })();

    console.log(`${logPrefix} Query instance created (${Date.now() - queryCreateStart}ms)`);

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Track the query instance for abort capability.
    // Also store on writer so abort-without-session-id can find it.
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempAttachmentPaths, tempDir, ws);
    }
    ws._pendingQueryInstance = queryInstance;

    // Process streaming messages with timeout on first message.
    // If the SDK (or underlying CLI) hangs during initialization (e.g. MCP
    // servers, OAuth refresh, network), we retry once before giving up.
    console.log(`${logPrefix} Waiting for first SDK message (timeout: ${FIRST_MESSAGE_TIMEOUT_MS}ms)...`);

    let firstResult;
    try {
      firstResult = await waitForFirstMessage(queryInstance, FIRST_MESSAGE_TIMEOUT_MS);
      console.log(`${logPrefix} First message received (${Date.now() - queryStartTime}ms total, type: ${firstResult.value?.type || 'done'})`);
    } catch (timeoutErr) {
      console.warn(`${logPrefix} ⚠ TIMEOUT: No response in ${FIRST_MESSAGE_TIMEOUT_MS}ms (${Date.now() - queryStartTime}ms total). Retrying...`);
      // Forcefully kill the hung query — interrupt() is cooperative, close() is forceful.
      try { await queryInstance.interrupt?.(); } catch (e) { console.debug(`${logPrefix} interrupt error (ignored):`, e.message); }
      try { await queryInstance.close?.(); } catch (e) { console.debug(`${logPrefix} close error (ignored):`, e.message); }
      if (capturedSessionId) removeSession(capturedSessionId);

      // Retry once — assign to ws._pendingQueryInstance immediately to avoid
      // a window where abort-pending-query would find null.
      const retryStart = Date.now();
      const retryInstance = createQueryInstance();
      ws._pendingQueryInstance = retryInstance;
      queryInstance = retryInstance;

      try {
        firstResult = await waitForFirstMessage(queryInstance, FIRST_MESSAGE_TIMEOUT_MS);
        console.log(`${logPrefix} ✓ Retry succeeded (${Date.now() - retryStart}ms, type: ${firstResult.value?.type || 'done'})`);
      } catch (retryErr) {
        console.error(`${logPrefix} ✗ Retry also timed out after ${Date.now() - retryStart}ms. Total elapsed: ${Date.now() - queryStartTime}ms. Giving up.`);
        try { await queryInstance.interrupt?.(); } catch (e) { console.debug(`${logPrefix} retry interrupt error (ignored):`, e.message); }
        try { await queryInstance.close?.(); } catch (e) { console.debug(`${logPrefix} retry close error (ignored):`, e.message); }
        ws._pendingQueryInstance = null;
        ws.send(createNormalizedMessage({ kind: 'error', content: 'Claude failed to start a session. Please try again.', sessionId: null, provider: 'claude' }));
        ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 1, sessionId: null, provider: 'claude' }));
        return;
      }
    }

    // Helper: register a session row (insert-or-ignore) with the given title.
    const registerSessionMeta = (sid, title = null) => {
      const cwd = options.cwd || process.cwd();
      sessionsMetaDb.upsertCreated({
        sessionId: sid, project: encodeProjectName(cwd), filePath: sessionFilePath(cwd, sid), cwd, title,
      });
    };

    // Process the first message that we already received
    const processMessage = (message) => {
      if (message.session_id && !capturedSessionId) {
        capturedSessionId = message.session_id;
        console.log(`${logPrefix} Session ID captured: ${capturedSessionId} (${Date.now() - queryStartTime}ms)`);
        addSession(capturedSessionId, queryInstance, tempAttachmentPaths, tempDir, ws);

        if (ws.userId) {
          try {
            sessionOwnershipDb.claim(capturedSessionId, 'claude', ws.userId);
          } catch (e) {
            console.warn('[SESSION] Failed to record ownership:', e.message);
          }
        }

        try {
          registerSessionMeta(capturedSessionId, truncateTitle(command));
        } catch (e) {
          console.warn('[SESSION] Failed to write sessions_meta:', e.message);
        }

        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(createNormalizedMessage({ kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'claude' }));
        }
      }

      // Defensive: if the SDK ever returns a different session_id mid-stream (fork/compaction),
      // register the new session and mark the old one superseded. Verified 2026-07-02: resume
      // keeps the same id, so this path should never fire in practice.
      if (message.session_id && capturedSessionId && message.session_id !== capturedSessionId) {
        try {
          registerSessionMeta(message.session_id, null);
          if (ws.userId) sessionOwnershipDb.claim(message.session_id, 'claude', ws.userId);
          sessionsMetaDb.supersede(capturedSessionId, message.session_id);
          console.warn(`[SESSION] session_id changed ${capturedSessionId} -> ${message.session_id}; superseded`);
          capturedSessionId = message.session_id;
        } catch (e) {
          console.warn('[SESSION] Failed to handle session_id change:', e.message);
        }
      }

      const transformedMessage = transformMessage(message);
      const sid = capturedSessionId || sessionId || null;

      const normalized = claudeAdapter.normalizeMessage(transformedMessage, sid);
      for (const msg of normalized) {
        if (transformedMessage.parentToolUseId && !msg.parentToolUseId) {
          msg.parentToolUseId = transformedMessage.parentToolUseId;
        }
        ws.send(msg);
      }

      if (message.type === 'result') {
        const models = Object.keys(message.modelUsage || {});
        for (const modelKey of models) {
          const md = message.modelUsage[modelKey];
          if (md) {
            try {
              usageDb.log(
                capturedSessionId || sessionId || null,
                modelKey,
                md.inputTokens || 0,
                md.outputTokens || 0,
                md.cacheReadInputTokens || 0,
                md.cacheCreationInputTokens || 0,
                md.costUSD || 0,
                queryText,
                ws.userId || null
              );
            } catch (e) {
              console.error('Usage logging error:', e.message);
            }
          }
        }

        try {
          if (sid) {
            // best-effort v1: one user prompt + one completed assistant response per query
            let row = sessionsMetaDb.recordActivity(sid, 'claude', 2);
            if (!row) {
              // resumed session predating write-through (not yet backfilled) — self-heal
              registerSessionMeta(sid, null);
              console.warn('[SESSION] sessions_meta row missing for', sid, '— self-healed');
              row = sessionsMetaDb.recordActivity(sid, 'claude', 2);
            }
            if (ws.userId && row) {
              const title = sessionNamesDb.getName(sid, 'claude') ?? row.title;
              broadcastToUser(ws.userId, {
                type: 'session_updated',
                project: row.project,
                session: { id: row.session_id, title, last_activity: row.last_activity, message_count: row.message_count },
              });
            }
          }
        } catch (e) {
          console.warn('[SESSION] Failed to update sessions_meta on result:', e.message);
        }

        const tokenBudgetData = extractTokenBudget(message);
        if (tokenBudgetData) {
          ws.send(createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: tokenBudgetData, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
        }
      }
    };

    // Handle first message
    if (!firstResult.done) {
      processMessage(firstResult.value);
    }

    // Continue processing remaining messages (no timeout — SDK is alive)
    for await (const message of queryInstance) {
      processMessage(message);
    }

    ws._pendingQueryInstance = null;

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary attachment files
    await cleanupTempFiles(tempAttachmentPaths, tempDir);

    // Send completion event
    console.log(`${logPrefix} Query completed (${Date.now() - queryStartTime}ms, session: ${capturedSessionId || 'none'})`);
    ws.send(createNormalizedMessage({ kind: 'complete', exitCode: 0, isNewSession: !sessionId && !!command, sessionId: capturedSessionId, provider: 'claude' }));
    notifyRunStopped({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      stopReason: 'completed'
    });
    // Complete

  } catch (error) {
    console.error(`${logPrefix} ✗ SDK query error (${Date.now() - queryStartTime}ms):`, error.message);

    ws._pendingQueryInstance = null;

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary attachment files on error
    await cleanupTempFiles(tempAttachmentPaths, tempDir);

    // Send error to WebSocket
    ws.send(createNormalizedMessage({ kind: 'error', content: error.message, sessionId: capturedSessionId || sessionId || null, provider: 'claude' }));
    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'claude',
      sessionId: capturedSessionId || sessionId || null,
      sessionName: sessionSummary,
      error
    });

    throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary attachment files
    await cleanupTempFiles(session.tempAttachmentPaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Get pending tool approvals for a specific session.
 * @param {string} sessionId - The session ID
 * @returns {Array} Array of pending permission request objects
 */
function getPendingApprovalsForSession(sessionId) {
  const pending = [];
  for (const [requestId, resolver] of pendingToolApprovals.entries()) {
    if (resolver._sessionId === sessionId) {
      pending.push({
        requestId,
        toolName: resolver._toolName || 'UnknownTool',
        input: resolver._input,
        context: resolver._context,
        sessionId,
        receivedAt: resolver._receivedAt || new Date(),
      });
    }
  }
  return pending;
}

/**
 * Reconnect a session's WebSocketWriter to a new raw WebSocket.
 * Called when client reconnects (e.g. page refresh) while SDK is still running.
 * @param {string} sessionId - The session ID
 * @param {Object} newRawWs - The new raw WebSocket connection
 * @returns {boolean} True if writer was successfully reconnected
 */
function reconnectSessionWriter(sessionId, newRawWs) {
  const session = getSession(sessionId);
  if (!session?.writer?.updateWebSocket) return false;
  session.writer.updateWebSocket(newRawWs);
  console.log(`[RECONNECT] Writer swapped for session ${sessionId}`);
  return true;
}

/**
 * Re-attach the writers of ALL active sessions owned by userId to a new raw
 * WebSocket. Called on every new authenticated chat connection so streams
 * survive reconnects without an explicit check-session-status from the client.
 * @returns {number} how many writers were re-attached
 */
function reattachUserSessionWriters(userId, newRawWs) {
  return reattachUserSessions(activeSessions, userId, newRawWs);
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  resolveToolApproval,
  getPendingApprovalsForSession,
  reconnectSessionWriter,
  reattachUserSessionWriters
};
