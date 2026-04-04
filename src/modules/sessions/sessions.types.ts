export type SessionStatus = 'created' | 'active' | 'paused' | 'closed' | 'expired';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Session {
  id: string;
  workspaceId: string;
  agentId?: string;
  status: SessionStatus;
  metadata: Record<string, unknown>;
  tokenCount: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
  tokenEstimate?: number;
  isCompacted: boolean;
  createdAt: Date;
}

export interface AddMessageInput {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
}
