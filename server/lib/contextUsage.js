export function fallbackContextWindow() {
  const parsed = parseInt(process.env.CONTEXT_WINDOW, 10);
  return Number.isFinite(parsed) ? parsed : 160000;
}

/**
 * @param {Object} usage - `message.usage` from an assistant message
 * @returns {number}
 */
export function contextUsedFromUsage(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

/**
 * @param {string} modelKey
 * @returns {number|null}
 */
export function contextWindowForModelKey(modelKey) {
  if (!modelKey) return null;
  if (modelKey.includes('[1m]')) return 1000000;
  if (/haiku/.test(modelKey)) return 200000;
  if (/(opus-(4-6|4-7|4-8|5)|sonnet-(4-6|5)|fable-5|mythos-5)\b/.test(modelKey)) return 1000000;
  if (/^(opus|sonnet|fable|mythos)$/.test(modelKey)) return 1000000;
  if (/claude|opus|sonnet|fable|mythos/.test(modelKey)) return 200000;
  return null;
}

/**
 * @param {Object} modelUsage - Record<string, ModelUsage>
 * @returns {string|null}
 */
export function primaryModelKey(modelUsage) {
  if (!modelUsage) return null;
  let best = null;
  let bestWeight = -1;
  for (const [key, data] of Object.entries(modelUsage)) {
    if (!data) continue;
    const weight = (data.cacheReadInputTokens || 0)
      + (data.cacheCreationInputTokens || 0)
      + (data.inputTokens || 0);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = key;
    }
  }
  return best;
}

/**
 * @param {Object|null} modelUsage
 * @param {string|null} model - plain model id
 * @returns {string|null}
 */
export function modelUsageKeyFor(modelUsage, model) {
  if (!modelUsage || !model) return null;
  for (const key of Object.keys(modelUsage)) {
    if (key === model || key.startsWith(`${model}[`)) return key;
  }
  return null;
}

/**
 * @param {Object|null} modelUsage
 * @param {string|null} answeringModel
 * @returns {string|null}
 */
export function resolveModelKey(modelUsage, answeringModel) {
  return modelUsageKeyFor(modelUsage, answeringModel)
    ?? answeringModel
    ?? primaryModelKey(modelUsage);
}

/**
 * @param {string} fileContent - raw JSONL
 * @returns {Array<Object>}
 */
export function parseTranscript(fileContent) {
  const entries = [];
  for (const line of fileContent.trim().split('\n')) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return entries;
}

/**
 * @param {unknown} model
 * @returns {boolean}
 */
function isRealModelId(model) {
  return typeof model === 'string' && model.length > 0 && !model.startsWith('<');
}

export function createLiveContextTracker() {
  let used = null;
  let model = null;
  return {
    /** @param {Object} message - SDK stream message */
    observe(message) {
      if (message.parent_tool_use_id) return;
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        const postTokens = message.compact_metadata?.post_tokens;
        used = Number.isFinite(postTokens) ? postTokens : 0;
        return;
      }
      if (message.type !== 'assistant' || !message.message?.usage) return;
      const realModel = isRealModelId(message.message.model);
      if (message.error && !realModel) return;
      used = contextUsedFromUsage(message.message.usage);
      if (realModel) model = message.message.model;
    },
    get used() {
      return used;
    },
    get model() {
      return model;
    },
  };
}

/**
 * @param {Array<Object>} entries - parsed transcript entries, in file order
 * @returns {{used: number, modelKey: string|null}}
 */
export function contextUsageFromEntries(entries) {
  let boundaryIndex = -1;
  let boundaryPostTokens = null;
  let lastModelUsage = null;
  let lastRealModel = null;
  const candidates = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    const isMainChain = entry.isSidechain !== true && !entry.isApiErrorMessage;
    if (!isMainChain) continue;

    if (entry.modelUsage) lastModelUsage = entry.modelUsage;

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      boundaryIndex = i;
      const postTokens = entry.compactMetadata?.postTokens;
      boundaryPostTokens = Number.isFinite(postTokens) ? postTokens : null;
      continue;
    }

    if (entry.type === 'assistant' && entry.message?.usage) {
      const model = isRealModelId(entry.message.model) ? entry.message.model : null;
      if (model) lastRealModel = model;
      candidates.push({
        index: i,
        timestamp: entry.timestamp || '',
        usage: entry.message.usage,
        model
      });
    }
  }

  const eligible = boundaryIndex >= 0
    ? candidates.filter((c) => c.index > boundaryIndex)
    : candidates;

  let chosen = null;
  for (const c of eligible) {
    if (!chosen
      || c.timestamp > chosen.timestamp
      || (c.timestamp === chosen.timestamp && c.index > chosen.index)) {
      chosen = c;
    }
  }

  if (!chosen) {
    return {
      used: boundaryPostTokens ?? 0,
      modelKey: resolveModelKey(lastModelUsage, lastRealModel)
    };
  }

  return {
    used: contextUsedFromUsage(chosen.usage),
    modelKey: resolveModelKey(lastModelUsage, chosen.model || lastRealModel)
  };
}

/**
 * @param {Array<Object>} entries - parsed transcript entries, in file order
 * @returns {{used: number, total: number, breakdown: {input: number, cacheCreation: number, cacheRead: number}}}
 */
export function legacyTokenBudgetFromEntries(entries) {
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'assistant' && entry.message?.usage) {
      const usage = entry.message.usage;
      inputTokens = usage.input_tokens || 0;
      cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      cacheReadTokens = usage.cache_read_input_tokens || 0;
      break;
    }
  }

  return {
    used: inputTokens + cacheCreationTokens + cacheReadTokens,
    total: fallbackContextWindow(),
    breakdown: {
      input: inputTokens,
      cacheCreation: cacheCreationTokens,
      cacheRead: cacheReadTokens
    }
  };
}

const sessionContextWindows = new Map();
const MAX_TRACKED_SESSIONS = 500;

/** @type {{get: (id: string) => number|null, set: (id: string, n: number) => void}|null} */
let durableStore = null;

export function setContextWindowStore(store) {
  durableStore = store;
}

function cacheContextWindow(sessionId, contextWindow) {
  sessionContextWindows.delete(sessionId);
  sessionContextWindows.set(sessionId, contextWindow);
  if (sessionContextWindows.size > MAX_TRACKED_SESSIONS) {
    sessionContextWindows.delete(sessionContextWindows.keys().next().value);
  }
}

export function rememberContextWindow(sessionId, contextWindow) {
  if (!sessionId || !Number.isFinite(contextWindow) || contextWindow <= 0) return;
  if (sessionContextWindows.get(sessionId) === contextWindow) return;
  cacheContextWindow(sessionId, contextWindow);
  try {
    durableStore?.set(sessionId, contextWindow);
  } catch (e) {
    console.warn('[CONTEXT] Failed to persist context window:', e?.message || e);
  }
}

function recallContextWindow(sessionId) {
  if (!sessionId) return null;
  const cached = sessionContextWindows.get(sessionId);
  if (cached) return cached;

  let stored = null;
  try {
    stored = durableStore?.get(sessionId) ?? null;
  } catch (e) {
    console.warn('[CONTEXT] Failed to read persisted context window:', e?.message || e);
  }
  if (stored) cacheContextWindow(sessionId, stored);
  return stored;
}

/**
 * @param {{sessionId?: string|null, modelKey?: string|null}} hints
 * @returns {number}
 */
export function resolveContextWindow({ sessionId = null, modelKey = null } = {}) {
  return recallContextWindow(sessionId)
    ?? contextWindowForModelKey(modelKey)
    ?? fallbackContextWindow();
}
