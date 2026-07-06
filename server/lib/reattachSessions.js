// Re-attach in-flight session writers to a user's new WebSocket connection.
// Pure helper (no SDK/db imports) so it is unit-testable in isolation.

/**
 * @param {Map<string, {writer?: {userId?: number|null, ws?: {readyState?: number}, updateWebSocket?: Function}}>} activeSessions
 * @param {number|null|undefined} userId - owner of the new connection
 * @param {Object} newRawWs - the new raw WebSocket
 * @returns {number} how many writers were re-attached
 */
export function reattachUserSessions(activeSessions, userId, newRawWs) {
  if (userId == null) return 0;
  let count = 0;
  for (const [sessionId, session] of activeSessions) {
    const writer = session?.writer;
    if (!writer || writer.userId !== userId) continue;
    if (typeof writer.updateWebSocket !== 'function') continue;
    // Only adopt sessions whose current socket is dead — a live socket means
    // another tab is streaming this session and must not lose it (multi-tab).
    // An abruptly-died peer can keep readyState OPEN until TCP notices; that
    // window is covered by the explicit check-session-status takeover path.
    if (writer.ws && writer.ws.readyState === 1) continue; // 1 = WebSocket.OPEN
    try {
      writer.updateWebSocket(newRawWs);
      count += 1;
    } catch (e) {
      // One broken session must not affect the connection or other sessions
      console.warn(`[RECONNECT] Failed to re-attach session ${sessionId}:`, e.message);
    }
  }
  return count;
}
