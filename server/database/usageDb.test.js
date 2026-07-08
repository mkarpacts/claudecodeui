// Unit tests for usageDb user scoping. db.js opens the DB at import time,
// so DATABASE_PATH must be set before the dynamic import below.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'usage-db-test-')),
  'test.db'
);

const { db, usageDb, userDb, initializeDatabase } = await import('./db.js');

const RANGE = { from: '2000-01-01', to: '2100-01-01' };
let alice, bob;

before(async () => {
  await initializeDatabase();
  alice = userDb.createUser('alice', 'x').id;
  bob = userDb.createUser('bob', 'x').id;
  // s1: 2 turns by alice; s2: 1 turn by bob; s3: 1 legacy turn without user_id
  usageDb.log('s1', 'claude-sonnet-4-6', 10, 5, 0, 0, 0.1, 'q1', alice);
  usageDb.log('s1', 'claude-sonnet-4-6', 20, 5, 0, 0, 0.2, 'q2', alice);
  usageDb.log('s2', 'claude-opus-4-8', 30, 5, 0, 0, 0.3, 'q3', bob);
  usageDb.log('s3', 'claude-sonnet-4-6', 40, 5, 0, 0, 0.4, 'q4', null);
});

test('getSessionsSummary without userId returns all sessions', () => {
  const { items, total } = usageDb.getSessionsSummary({ ...RANGE });
  assert.equal(total, 3);
  assert.deepEqual(items.map(i => i.session_id).sort(), ['s1', 's2', 's3']);
});

test('getSessionsSummary with userId returns only that user sessions (NULL user_id excluded)', () => {
  const { items, total } = usageDb.getSessionsSummary({ ...RANGE, userId: alice });
  assert.equal(total, 1);
  assert.equal(items[0].session_id, 's1');
  assert.equal(items[0].turn_count, 2);
});

test('getSessionsSummary combines userId with model filter', () => {
  const { total } = usageDb.getSessionsSummary({ ...RANGE, model: 'opus', userId: alice });
  assert.equal(total, 0);
});

test('getTotals scopes totals to userId', () => {
  const all = usageDb.getTotals({ ...RANGE });
  assert.equal(all.session_count, 3);
  const own = usageDb.getTotals({ ...RANGE, userId: alice });
  assert.equal(own.session_count, 1);
  assert.equal(own.total_tokens, 40); // 10+5 + 20+5
});

test('getSessionTurns without userId returns all turns of the session', () => {
  const { items, total } = usageDb.getSessionTurns('s1');
  assert.equal(total, 2);
  assert.deepEqual(items.map(t => t.query_text), ['q1', 'q2']);
});

test('getSessionTurns with userId hides sessions of other users', () => {
  const own = usageDb.getSessionTurns('s1', { userId: alice });
  assert.equal(own.total, 2);
  const foreign = usageDb.getSessionTurns('s2', { userId: alice });
  assert.equal(foreign.total, 0);
  assert.equal(foreign.items.length, 0);
});

test('getSessionsSummary supports limit -1 (no limit) for export', () => {
  const { items, total } = usageDb.getSessionsSummary({ ...RANGE, limit: -1, offset: 0 });
  assert.equal(total, 3);
  assert.equal(items.length, 3);
});

test('getUsageUsers returns distinct users having usage rows, sorted by name', () => {
  const users = usageDb.getUsageUsers();
  assert.deepEqual(users.map(u => u.username), ['alice', 'bob']);
  assert.ok(users.every(u => typeof u.id === 'number'));
});
