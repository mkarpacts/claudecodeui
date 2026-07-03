// Registry of chat WS clients for owner-scoped push (session_updated/renamed/deleted).
const OPEN = 1; // WebSocket.OPEN without importing ws here
const clients = new Map(); // ws -> userId

export function registerClient(ws, userId) { clients.set(ws, userId ?? null); }
export function unregisterClient(ws) { clients.delete(ws); }

export function broadcastToUser(userId, payload) {
  if (userId === null || userId === undefined) return;
  const msg = JSON.stringify(payload);
  for (const [ws, uid] of clients) {
    if (ws.readyState === OPEN && uid === userId) try { ws.send(msg); } catch { /* socket died mid-send — skip */ }
  }
}

export function _resetForTests() { clients.clear(); }
