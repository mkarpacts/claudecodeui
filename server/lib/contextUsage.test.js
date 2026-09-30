import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contextUsageFromEntries,
  createLiveContextTracker,
  contextUsedFromUsage,
  contextWindowForModelKey,
  legacyTokenBudgetFromEntries,
  modelUsageKeyFor,
  parseTranscript,
  primaryModelKey,
  rememberContextWindow,
  resolveContextWindow,
} from './contextUsage.js';

const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n');
const contextUsageFromTranscript = (content) => contextUsageFromEntries(parseTranscript(content));
const legacyTokenBudgetFromTranscript = (content) => legacyTokenBudgetFromEntries(parseTranscript(content));

const assistant = (usage, extra = {}) => ({
  type: 'assistant',
  message: { usage },
  ...extra,
});

test('context occupancy excludes output tokens', () => {
  const used = contextUsedFromUsage({
    input_tokens: 100,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 3,
    output_tokens: 9999,
  });
  assert.equal(used, 123);
});

test('missing usage fields count as zero, not NaN', () => {
  assert.equal(contextUsedFromUsage({}), 0);
  assert.equal(contextUsedFromUsage(null), 0);
  assert.equal(contextUsedFromUsage({ input_tokens: 5 }), 5);
});

test('transcript reports the last assistant entry, never the sum', () => {
  const content = jsonl(
    assistant({ input_tokens: 1000, cache_read_input_tokens: 500 }),
    { type: 'user', message: {} },
    assistant({ input_tokens: 10, cache_read_input_tokens: 7 }),
  );
  assert.equal(contextUsageFromTranscript(content).used, 17);
});

test('after compaction the post-compaction entry wins', () => {
  const content = jsonl(
    assistant({ input_tokens: 900000 }),
    {
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto', preTokens: 900000, postTokens: 22235 },
    },
    assistant({ input_tokens: 30000, cache_read_input_tokens: 1000 }),
  );
  assert.equal(contextUsageFromTranscript(content).used, 31000);
});

test('compaction with nothing answered since falls back to postTokens', () => {
  const content = jsonl(
    assistant({ input_tokens: 900000 }),
    {
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'manual', preTokens: 900000, postTokens: 13691 },
    },
  );
  assert.equal(contextUsageFromTranscript(content).used, 13691);
});

test('unparsable lines are skipped rather than fatal', () => {
  const content = [
    JSON.stringify(assistant({ input_tokens: 42 })),
    '{ half-written line',
  ].join('\n');
  assert.equal(contextUsageFromTranscript(content).used, 42);
});

test('transcript with no assistant entry reports zero', () => {
  const content = jsonl({ type: 'user', message: {} });
  assert.equal(contextUsageFromTranscript(content).used, 0);
});

test('primary model is the one carrying the conversation, not a subagent', () => {
  const modelUsage = {
    'claude-haiku-4-5-20251001': { inputTokens: 900, cacheReadInputTokens: 0 },
    'claude-opus-5[1m]': { inputTokens: 5318, cacheReadInputTokens: 20975263 },
  };
  assert.equal(primaryModelKey(modelUsage), 'claude-opus-5[1m]');
});

test('the window follows the answering model, not the busiest one', () => {
  const content = jsonl(
    { modelUsage: {
      'claude-haiku-4-5-20251001': { inputTokens: 900000, cacheReadInputTokens: 0 },
      'claude-opus-5[1m]': { inputTokens: 10, cacheReadInputTokens: 20 },
    } },
    {
      type: 'assistant',
      timestamp: '2026-09-14T10:00:00Z',
      message: { model: 'claude-opus-5', usage: { input_tokens: 300000 } },
    },
  );

  const { modelKey } = contextUsageFromTranscript(content);
  assert.equal(modelKey, 'claude-opus-5[1m]');
  assert.equal(resolveContextWindow({ sessionId: null, modelKey }), 1000000);
});

test('modelUsageKeyFor matches a plain id against its 1m-marked key', () => {
  const modelUsage = { 'claude-opus-5[1m]': {}, 'claude-haiku-4-5-20251001': {} };
  assert.equal(modelUsageKeyFor(modelUsage, 'claude-opus-5'), 'claude-opus-5[1m]');
  assert.equal(modelUsageKeyFor(modelUsage, 'claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
  assert.equal(modelUsageKeyFor(modelUsage, 'claude-sonnet-5'), null);
  assert.equal(modelUsageKeyFor(null, 'claude-opus-5'), null);
});

test('primary model of an empty map is null', () => {
  assert.equal(primaryModelKey({}), null);
  assert.equal(primaryModelKey(null), null);
});

test('the 1m marker in a model key means the million-token window', () => {
  assert.equal(contextWindowForModelKey('claude-opus-5[1m]'), 1000000);
  assert.equal(contextWindowForModelKey('claude-haiku-4-5-20251001'), 200000);
  assert.equal(contextWindowForModelKey('claude-sonnet-5'), 1000000);
  assert.equal(contextWindowForModelKey('something-unknown'), null);
  assert.equal(contextWindowForModelKey(null), null);
});

test('older generations are not sized as if they were 1M models', () => {
  assert.equal(contextWindowForModelKey('claude-sonnet-4-5-20250929'), 200000);
  assert.equal(contextWindowForModelKey('claude-opus-4-1-20250805'), 200000);
  assert.equal(contextWindowForModelKey('claude-3-5-sonnet-20241022'), 200000);
  assert.equal(contextWindowForModelKey('claude-opus-4-5'), 200000);

  assert.equal(contextWindowForModelKey('claude-opus-4-6'), 1000000);
  assert.equal(contextWindowForModelKey('claude-opus-4-8'), 1000000);
  assert.equal(contextWindowForModelKey('claude-sonnet-4-6'), 1000000);
  assert.equal(contextWindowForModelKey('claude-fable-5-1'), 1000000);

  assert.equal(contextWindowForModelKey('opus'), 1000000);
  assert.equal(contextWindowForModelKey('sonnet'), 1000000);
});

test('a window learned from the SDK outranks one guessed from the name', () => {
  const sessionId = `test-session-${Math.random()}`;
  assert.equal(
    resolveContextWindow({ sessionId, modelKey: 'claude-haiku-4-5-20251001' }),
    200000,
  );

  rememberContextWindow(sessionId, 654321);
  assert.equal(
    resolveContextWindow({ sessionId, modelKey: 'claude-haiku-4-5-20251001' }),
    654321,
  );
});

test('acceptance 1: a subagent answering last does not become the reading', () => {
  const content = jsonl(
    {
      type: 'assistant',
      timestamp: '2026-09-14T10:00:00Z',
      message: { usage: { input_tokens: 5000, cache_read_input_tokens: 100000 }, model: 'claude-opus-5' },
    },
    {
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-09-14T10:05:00Z',
      message: { usage: { input_tokens: 12, cache_read_input_tokens: 30 }, model: 'claude-haiku-4-5-20251001' },
    },
  );
  assert.equal(contextUsageFromTranscript(content).used, 105000);
});

test('acceptance 1b: a failed API call never occupied the window', () => {
  const content = jsonl(
    { type: 'assistant', timestamp: '2026-09-14T10:00:00Z', message: { usage: { input_tokens: 7000 }, model: 'claude-opus-5' } },
    { type: 'assistant', isApiErrorMessage: true, timestamp: '2026-09-14T10:06:00Z', message: { usage: { input_tokens: 3 } } },
  );
  assert.equal(contextUsageFromTranscript(content).used, 7000);
});

test('acceptance 1c: newest by timestamp wins over last in the file', () => {
  const content = jsonl(
    { type: 'assistant', timestamp: '2026-09-14T10:09:00Z', message: { usage: { input_tokens: 900 }, model: 'claude-opus-5' } },
    { type: 'assistant', timestamp: '2026-09-14T10:01:00Z', message: { usage: { input_tokens: 111 }, model: 'claude-opus-5' } },
  );
  assert.equal(contextUsageFromTranscript(content).used, 900);
});

test('acceptance 2: with no cost-state record the ceiling is still the real one', () => {
  const content = jsonl({
    type: 'assistant',
    timestamp: '2026-09-14T10:00:00Z',
    message: {
      model: 'claude-opus-5',
      usage: { input_tokens: 2, cache_creation_input_tokens: 532, cache_read_input_tokens: 144023 },
    },
  });

  const { used, modelKey } = contextUsageFromTranscript(content);
  assert.equal(used, 144557);
  assert.equal(modelKey, 'claude-opus-5');
  assert.equal(resolveContextWindow({ sessionId: null, modelKey }), 1000000);
});

test('acceptance 3: a compaction boundary last reports its postTokens', () => {
  const content = jsonl(
    { type: 'assistant', timestamp: '2026-09-14T09:00:00Z', message: { usage: { input_tokens: 900000 }, model: 'claude-opus-5' } },
    {
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2026-09-14T10:00:00Z',
      compactMetadata: { trigger: 'auto', preTokens: 900000, postTokens: 22235 },
    },
  );
  assert.equal(contextUsageFromTranscript(content).used, 22235);
});

test('a sidechain compaction boundary is not the main conversation’s', () => {
  const content = jsonl(
    { type: 'assistant', timestamp: '2026-09-14T09:00:00Z', message: { usage: { input_tokens: 4000 }, model: 'claude-opus-5' } },
    {
      type: 'system',
      subtype: 'compact_boundary',
      isSidechain: true,
      timestamp: '2026-09-14T10:00:00Z',
      compactMetadata: { postTokens: 11 },
    },
  );
  assert.equal(contextUsageFromTranscript(content).used, 4000);
});

test('regression: context rules do not reach the figures /cost reads', () => {
  const plain = jsonl({
    type: 'assistant',
    timestamp: '2026-09-14T10:00:00Z',
    message: { model: 'claude-opus-5', usage: { input_tokens: 10, cache_read_input_tokens: 90 } },
  });

  const withNoise = jsonl(
    {
      type: 'assistant',
      timestamp: '2026-09-14T10:00:00Z',
      message: { model: 'claude-opus-5', usage: { input_tokens: 10, cache_read_input_tokens: 90 } },
    },
    {
      type: 'assistant',
      isSidechain: true,
      timestamp: '2026-09-14T10:30:00Z',
      message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 7, cache_read_input_tokens: 3 } },
    },
  );

  assert.equal(contextUsageFromTranscript(plain).used, 100);
  assert.equal(contextUsageFromTranscript(withNoise).used, 100);

  assert.equal(legacyTokenBudgetFromTranscript(plain).used, 100);
  assert.equal(legacyTokenBudgetFromTranscript(withNoise).used, 10);
});

test('regression: the legacy budget ignores compaction boundaries', () => {
  const content = jsonl(
    {
      type: 'assistant',
      timestamp: '2026-09-14T09:00:00Z',
      message: { model: 'claude-opus-5', usage: { input_tokens: 800000 } },
    },
    {
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2026-09-14T10:00:00Z',
      compactMetadata: { postTokens: 15000 },
    },
  );

  assert.equal(contextUsageFromTranscript(content).used, 15000);
  assert.equal(legacyTokenBudgetFromTranscript(content).used, 800000);
});

test('regression: the legacy budget keeps the configured ceiling, not the model’s', () => {
  const content = jsonl({
    type: 'assistant',
    timestamp: '2026-09-14T10:00:00Z',
    message: { model: 'claude-opus-5', usage: { input_tokens: 5 } },
  });

  const { modelKey } = contextUsageFromTranscript(content);
  assert.equal(resolveContextWindow({ sessionId: null, modelKey }), 1000000);
  assert.equal(legacyTokenBudgetFromTranscript(content).total, 160000);
});

test('nonsense ceilings are not remembered', () => {
  const sessionId = `test-session-${Math.random()}`;
  rememberContextWindow(sessionId, 0);
  rememberContextWindow(sessionId, NaN);
  rememberContextWindow(sessionId, undefined);
  assert.equal(resolveContextWindow({ sessionId, modelKey: 'claude-sonnet-5' }), 1000000);
});

const liveAssistant = (usage, extra = {}) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { model: 'claude-opus-5', usage },
  ...extra,
});

test('live tracker ignores synthetic API-error messages', () => {
  const tracker = createLiveContextTracker();
  tracker.observe(liveAssistant({ input_tokens: 10, cache_read_input_tokens: 900000 }));
  tracker.observe({
    type: 'assistant',
    parent_tool_use_id: null,
    error: 'invalid_request',
    message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
  });
  assert.equal(tracker.used, 900010);
  assert.equal(tracker.model, 'claude-opus-5');
});

test('live tracker keeps real usage from a max_output_tokens reply', () => {
  const tracker = createLiveContextTracker();
  tracker.observe(liveAssistant({ input_tokens: 5, cache_read_input_tokens: 120 }, { error: 'max_output_tokens' }));
  assert.equal(tracker.used, 125);
});

test('live tracker uses post-compaction tokens after compact_boundary', () => {
  const tracker = createLiveContextTracker();
  tracker.observe(liveAssistant({ input_tokens: 850000 }));
  tracker.observe({
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'manual', pre_tokens: 850000, post_tokens: 80000 },
  });
  assert.equal(tracker.used, 80000);
  tracker.observe(liveAssistant({ input_tokens: 81000 }));
  assert.equal(tracker.used, 81000);
});

test('live tracker ignores subagent messages and starts empty', () => {
  const tracker = createLiveContextTracker();
  assert.equal(tracker.used, null);
  tracker.observe(liveAssistant({ input_tokens: 7 }, { parent_tool_use_id: 'toolu_1' }));
  assert.equal(tracker.used, null);
  assert.equal(tracker.model, null);
});
