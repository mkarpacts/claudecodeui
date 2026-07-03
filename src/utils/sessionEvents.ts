import type { SessionUpdatedMessage, SessionRenamedMessage, SessionDeletedMessage } from '../types/app';

export type SessionChangedMessage = SessionUpdatedMessage | SessionRenamedMessage | SessionDeletedMessage;
export const SESSIONS_CHANGED_EVENT = 'sessions-changed';

export function dispatchSessionsChanged(message: SessionChangedMessage): void {
  window.dispatchEvent(new CustomEvent<SessionChangedMessage>(SESSIONS_CHANGED_EVENT, { detail: message }));
}

export function subscribeSessionsChanged(handler: (message: SessionChangedMessage) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<SessionChangedMessage>).detail);
  window.addEventListener(SESSIONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, listener);
}
