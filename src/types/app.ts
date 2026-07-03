export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  lastActivity?: string | null;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface SessionUpdatedMessage {
  type: 'session_updated';
  project: string;
  session: {
    id: string;
    title: string | null;
    last_activity: string;
    message_count: number;
  };
  [key: string]: unknown;
}

export interface SessionRenamedMessage {
  type: 'session_renamed';
  project: string;
  sessionId: string;
  title: string;
  [key: string]: unknown;
}

export interface SessionDeletedMessage {
  type: 'session_deleted';
  project: string;
  sessionId: string;
  [key: string]: unknown;
}

export type AppSocketMessage =
  | SessionUpdatedMessage
  | SessionRenamedMessage
  | SessionDeletedMessage
  | { type?: string;[key: string]: unknown };
