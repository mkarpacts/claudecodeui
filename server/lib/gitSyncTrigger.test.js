import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { triggerGitSync } from './gitSyncTrigger.js';

function listenOnEphemeralPort() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('resolves ok:true when the listener accepts the connection', async () => {
  const server = await listenOnEphemeralPort();
  const { port } = server.address();
  try {
    const result = await triggerGitSync({ host: '127.0.0.1', port });
    assert.equal(result.ok, true);
  } finally {
    server.close();
  }
});

test('resolves refused when nothing listens (sync already running)', async () => {
  // Grab a free port, then close the server so the port is guaranteed unused.
  const server = await listenOnEphemeralPort();
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));

  const result = await triggerGitSync({ host: '127.0.0.1', port });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'refused');
});

test('resolves error (never rejects) for an invalid port', async () => {
  const result = await triggerGitSync({ host: '127.0.0.1', port: NaN });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
});

test('resolves error (not refused) for unresolvable host', async () => {
  const result = await triggerGitSync({ host: 'host.invalid', port: 9000, timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, 'refused');
});
