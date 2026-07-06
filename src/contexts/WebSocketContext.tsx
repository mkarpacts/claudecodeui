import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { readStoredToken } from '../components/auth/constants';
import { IS_PLATFORM } from '../constants/config';
import { dispatchSessionsChanged } from '../utils/sessionEvents';

const SESSION_EVENT_TYPES = new Set(['session_updated', 'session_renamed', 'session_deleted']);

const RECONNECT_DELAY_MS = 3_000;
const PING_TIMEOUT_MS = 5_000;
const MAX_PENDING_MESSAGES = 10;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (stateToken: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  // Storage holds the freshest token (REST auto-refresh), while the state token can
  // expire mid-session — and the server rejects expired tokens on every reconnect.
  const token = readStoredToken() ?? stateToken;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const pendingMessagesRef = useRef<any[]>([]);
  const { token } = useAuth();

  useEffect(() => {
    let cancelled = false;
    let connecting = false; // a socket is between new WebSocket() and open/close — blocks duplicate connects
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearPingTimeout = () => {
      if (pingTimeout) {
        clearTimeout(pingTimeout);
        pingTimeout = null;
      }
    };

    const doConnect = () => {
      if (cancelled || connecting) return; // wsRef stays null while CONNECTING; this guard prevents a second concurrent socket
      try {
        const wsUrl = buildWebSocketUrl(token);
        if (!wsUrl) {
          console.warn('No authentication token found for WebSocket connection');
          return;
        }

        console.log('[WS] Connecting…');
        connecting = true;
        const websocket = new WebSocket(wsUrl);

        websocket.onopen = () => {
          connecting = false;
          if (cancelled) { websocket.close(); return; }
          console.log(`[WS] ${hasConnectedRef.current ? 'Reconnected' : 'Connected'}`);
          setIsConnected(true);
          wsRef.current = websocket;
          if (hasConnectedRef.current) {
            // This is a reconnect — signal so components can catch up on missed messages
            setLatestMessage({ type: 'websocket-reconnected', timestamp: Date.now() });
          }
          hasConnectedRef.current = true;

          // Flush any messages that were queued while disconnected
          const pending = pendingMessagesRef.current;
          if (pending.length > 0) {
            console.log(`[WS] Flushing ${pending.length} queued message(s)`);
            pendingMessagesRef.current = [];
            pending.forEach(msg => websocket.send(JSON.stringify(msg)));
          }
        };

        websocket.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data);
            if (data?.type === 'pong') {
              clearPingTimeout();
              return;
            }
            // Session-list events must be delivered losslessly. latestMessage is a
            // single state value: during streaming the server sends session_updated
            // immediately followed by status/complete, and React coalesces the state
            // updates — an effect watching latestMessage can never see the
            // intermediate value. Dispatch synchronously, outside React state.
            if (data?.type && SESSION_EVENT_TYPES.has(data.type)) {
              dispatchSessionsChanged(data);
            }
            setLatestMessage(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        websocket.onclose = (event) => {
          connecting = false;
          if (cancelled) return;
          clearPingTimeout();
          console.warn(`[WS] Disconnected (code=${event.code}, reason=${event.reason || 'none'})`);
          setIsConnected(false);
          wsRef.current = null;

          // Attempt to reconnect after 3 seconds (doConnect itself bails if cancelled)
          reconnectTimeout = setTimeout(doConnect, RECONNECT_DELAY_MS);
        };

        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        connecting = false;
        console.error('Error creating WebSocket connection:', error);
      }
    };

    // Tabs woken from sleep can hold a half-open socket that still reports
    // OPEN but is dead on the wire (the server closed it while the tab was
    // frozen, so onclose never fired). Verify whenever the tab becomes visible.
    const verifyConnection = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const socket = wsRef.current;
      if (!socket) {
        // The reconnect timer may have been throttled away while the tab slept
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        doConnect();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return; // CONNECTING/CLOSING — let normal handlers run
      if (pingTimeout) return; // probe already in flight
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        socket.close();
        return;
      }
      // Server answers ping synchronously, so 5s comfortably covers a healthy
      // round-trip; a miss means the socket is dead, not merely slow.
      pingTimeout = setTimeout(() => {
        pingTimeout = null;
        console.warn('[WS] Ping timed out — closing zombie socket');
        socket.close(); // fires onclose → normal reconnect path
      }, PING_TIMEOUT_MS);
    };
    document.addEventListener('visibilitychange', verifyConnection);

    doConnect();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', verifyConnection);
      clearPingTimeout();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent stale onclose from firing after cleanup
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, [token]);

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    console.warn(`[WS] Message queued (readyState=${socket?.readyState ?? 'no socket'}): ${message?.type || 'unknown'}`);
    pendingMessagesRef.current.push(message);
    if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
      const dropped = pendingMessagesRef.current.shift();
      console.error(`[WS] Pending queue full, dropped oldest message: ${dropped?.type || 'unknown'}`);
    }
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
