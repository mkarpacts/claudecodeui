import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Wakes the git-sync container by opening a TCP connection to its trigger
 * port. The connection itself is the signal — no payload is sent.
 *
 * Resolves (never rejects) with:
 *   { ok: true }                                  — trigger delivered
 *   { ok: false, reason: 'refused' }              — port closed: a sync cycle is running
 *   { ok: false, reason: 'timeout' | 'error' }    — container/DNS unreachable
 */
export function triggerGitSync({ host, port, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let socket;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(result);
    };
    try {
      socket = net.connect({ host, port });
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => settle({ ok: true }));
      socket.on('timeout', () => settle({ ok: false, reason: 'timeout' }));
      socket.on('error', (err) =>
        settle({ ok: false, reason: err.code === 'ECONNREFUSED' ? 'refused' : 'error', code: err.code })
      );
    } catch (err) {
      // net.connect validates arguments synchronously (e.g. NaN or out-of-range
      // port) and throws before returning a socket. Keep the never-rejects contract.
      settle({ ok: false, reason: 'error', code: err.code });
    }
  });
}
