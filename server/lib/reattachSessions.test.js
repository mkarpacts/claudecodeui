import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reattachUserSessions } from './reattachSessions.js';

const deadWs = () => ({ readyState: 3 }); // CLOSED
const writerFor = (userId) => {
  const w = { userId, ws: deadWs(), updateWebSocket(newWs) { w.ws = newWs; } };
  return w;
};

test('re-attaches only sessions whose writer belongs to the user', () => {
  const mine = writerFor(1);
  const other = writerFor(2);
  const sessions = new Map([
    ['s1', { writer: mine }],
    ['s2', { writer: other }],
    ['s3', {}], // session without a writer (e.g. SSE transport)
  ]);
  const newWs = { tag: 'new' };
  assert.equal(reattachUserSessions(sessions, 1, newWs), 1);
  assert.equal(mine.ws, newWs);
  assert.notEqual(other.ws, newWs);
});

test('does nothing without a userId', () => {
  const w = writerFor(null);
  const sessions = new Map([['s1', { writer: w }]]);
  const newWs = { tag: 'new' };
  assert.equal(reattachUserSessions(sessions, null, newWs), 0);
  assert.equal(reattachUserSessions(sessions, undefined, newWs), 0);
  assert.notEqual(w.ws, newWs); // null-userId writer must NOT match a null caller
});

test('does not steal a writer whose current socket is still open (multi-tab)', () => {
  const live = writerFor(1);
  live.ws = { readyState: 1 }; // OPEN — another tab is streaming
  const dead = writerFor(1); // ws stays CLOSED
  const sessions = new Map([['s1', { writer: live }], ['s2', { writer: dead }]]);
  const newWs = { tag: 'new' };
  assert.equal(reattachUserSessions(sessions, 1, newWs), 1);
  assert.equal(live.ws.readyState, 1); // untouched
  assert.equal(dead.ws, newWs);
});

test('one failing writer does not stop the rest', () => {
  const bad = { userId: 1, updateWebSocket() { throw new Error('boom'); } };
  const good = writerFor(1);
  const sessions = new Map([['s1', { writer: bad }], ['s2', { writer: good }]]);
  const newWs = { tag: 'new' };
  assert.equal(reattachUserSessions(sessions, 1, newWs), 1);
  assert.equal(good.ws, newWs);
});
