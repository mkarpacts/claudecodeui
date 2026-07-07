import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, buildSessionTurnsCsv } from './usageCsv.js';

const turn = (overrides = {}) => ({
  query_text: 'hello',
  model: 'claude-sonnet-4-6',
  input_tokens: 10,
  cache_read_tokens: 20,
  cache_creation_tokens: 30,
  output_tokens: 40,
  total_tokens: 100,
  cost_usd: 0.5,
  created_at: '2026-07-07 10:00:00',
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
test('buildSessionTurnsCsv starts with BOM followed directly by the header', () => {
  const csv = buildSessionTurnsCsv([turn()]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.slice(1, 2), '#');
  assert.ok(!csv.includes('sep='));
});

test('buildSessionTurnsCsv writes header and one line per turn in order', () => {
  const csv = buildSessionTurnsCsv([turn(), turn({ query_text: 'second', cost_usd: 1.25 })]);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 3); // header + 2 rows
  assert.equal(lines[0], '#,time,query,model,input_tokens,cache_read_tokens,cache_creation_tokens,output_tokens,total_tokens,cost_usd');
  assert.equal(lines[1], '1,2026-07-07 10:00:00,hello,claude-sonnet-4-6,10,20,30,40,100,0.5');
  assert.equal(lines[2], '2,2026-07-07 10:00:00,second,claude-sonnet-4-6,10,20,30,40,100,1.25');
});

test('buildSessionTurnsCsv escapes query text with commas and newlines', () => {
  const csv = buildSessionTurnsCsv([turn({ query_text: 'fix a, then\nb' })]);
  assert.ok(csv.includes('"fix a, then\nb"'));
});

test('buildSessionTurnsCsv with no turns emits just the header', () => {
  const csv = buildSessionTurnsCsv([]);
  assert.equal(csv.slice(1), '#,time,query,model,input_tokens,cache_read_tokens,cache_creation_tokens,output_tokens,total_tokens,cost_usd\r\n');
});
