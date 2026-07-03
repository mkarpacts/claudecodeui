import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerClient, unregisterClient, broadcastToUser, _resetForTests } from './wsHub.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); } });

test('broadcastToUser sends only to that user\'s open sockets', () => {
  _resetForTests();
  const a1 = fakeWs(), a2 = fakeWs(), b = fakeWs();
  const closed = { readyState: 3, sent: [], send(m) { this.sent.push(m); } };
  registerClient(a1, 1); registerClient(a2, 1); registerClient(b, 2); registerClient(closed, 1);
  broadcastToUser(1, { type: 'session_updated', x: 1 });
  assert.equal(a1.sent.length, 1);
  assert.equal(a2.sent.length, 1);
  assert.equal(b.sent.length, 0);
  assert.equal(closed.sent.length, 0);
  unregisterClient(a1);
  broadcastToUser(1, { type: 'session_updated', x: 2 });
  assert.equal(a1.sent.length, 1);
  assert.equal(a2.sent.length, 2);
});

test('never sends to sockets registered without a user id', () => {
  _resetForTests();
  const anon = fakeWs();
  registerClient(anon); // no userId
  broadcastToUser(undefined, { type: 'session_updated' });
  broadcastToUser(null, { type: 'session_updated' });
  assert.equal(anon.sent.length, 0);
});
