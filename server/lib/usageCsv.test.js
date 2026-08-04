import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, buildSessionsSummaryCsv } from './usageCsv.js';

const session = (overrides = {}) => ({
  session_id: 'abc-123',
  session_name: 'My session',
  first_query_text: 'first question',
  username: 'alice',
  first_turn: '2026-06-15 08:33:38',
  models: 'claude-opus-4-20250514,claude-haiku-3-5-20241022',
  total_context: 1500,
  total_output: 40,
  total_tokens: 1540,
  total_cost: 0.5,
  turn_count: 6,
  ...overrides,
});

test('csvEscape passes plain values through', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape(42), '42');
});

test('csvEscape returns empty string for null/undefined', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('csvEscape quotes values with commas, quotes and newlines', () => {
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
});

test('csvEscape neutralizes Excel formula injection', () => {
  assert.equal(csvEscape('=1+2'), "'=1+2");
  assert.equal(csvEscape('@cmd'), "'@cmd");
  assert.equal(csvEscape('+SUM(A1)'), "'+SUM(A1)");
  assert.equal(csvEscape('-2+3'), "'-2+3");
});

// No "sep=" hint line: Excel ignores the UTF-8 BOM when the file starts with
// one and falls back to ANSI, garbling diacritics (reproduced via COM on Excel 16.0).
test('buildSessionsSummaryCsv starts with BOM followed directly by the header', () => {
  const csv = buildSessionsSummaryCsv([session()]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.slice(1, 2), '#');
  assert.ok(!csv.includes('sep='));
});

test('buildSessionsSummaryCsv writes header and one line per session in order', () => {
  const csv = buildSessionsSummaryCsv([session(), session({ session_name: 'Second', total_cost: 1.25 })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 3); // header + 2 rows
  assert.equal(lines[0], '#,session,user,date,model,context_tokens,output_tokens,total_tokens,cost_usd,turns');
  assert.equal(lines[1], '1,My session,alice,2026-06-15,opus; haiku,1500,40,1540,0.5,6');
  assert.equal(lines[2], '2,Second,alice,2026-06-15,opus; haiku,1500,40,1540,1.25,6');
});

test('buildSessionsSummaryCsv falls back to first query text, then session id', () => {
  const csv = buildSessionsSummaryCsv([
    session({ session_name: null }),
    session({ session_name: null, first_query_text: null }),
  ]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1], '1,first question,alice,2026-06-15,opus; haiku,1500,40,1540,0.5,6');
  assert.equal(lines[2], '2,abc-123,alice,2026-06-15,opus; haiku,1500,40,1540,0.5,6');
});

test('buildSessionsSummaryCsv writes only the date part of first_turn', () => {
  const csv = buildSessionsSummaryCsv([session({ first_turn: '2026-01-03 23:59:59' })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1].split(',')[3], '2026-01-03');
});

test('buildSessionsSummaryCsv maps model ids to short names and dedupes them', () => {
  const csv = buildSessionsSummaryCsv([
    session({ models: 'claude-opus-4-20250514,claude-opus-4-1-20250805,claude-sonnet-4-20250514' }),
  ]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1].split(',')[4], 'opus; sonnet');
});

test('buildSessionsSummaryCsv keeps unknown model ids as-is', () => {
  const csv = buildSessionsSummaryCsv([session({ models: 'gpt-5-mini' })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1].split(',')[4], 'gpt-5-mini');
});

test('buildSessionsSummaryCsv leaves date and model empty for rows without them', () => {
  const csv = buildSessionsSummaryCsv([session({ first_turn: null, models: null })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1], '1,My session,alice,,,1500,40,1540,0.5,6');
});

test('buildSessionsSummaryCsv escapes session names with commas and newlines', () => {
  const csv = buildSessionsSummaryCsv([session({ session_name: 'fix a, then\nb' })]);
  assert.ok(csv.includes('"fix a, then\nb"'));
});

test('buildSessionsSummaryCsv leaves user empty for legacy rows without user', () => {
  const csv = buildSessionsSummaryCsv([session({ username: null })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[1], '1,My session,,2026-06-15,opus; haiku,1500,40,1540,0.5,6');
});

test('buildSessionsSummaryCsv with no sessions emits just the header', () => {
  const csv = buildSessionsSummaryCsv([]);
  assert.equal(csv.slice(1), '#,session,user,date,model,context_tokens,output_tokens,total_tokens,cost_usd,turns\r\n');
});
