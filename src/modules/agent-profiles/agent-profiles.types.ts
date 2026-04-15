export type AgentCategory =
  | 'executor'
  | 'planner'
  | 'researcher'
  | 'reviewer'
  | 'visual'
  | 'ops'
  | 'deep'
  | 'quick';

export type PermissionMode = 'auto' | 'ask' | 'strict';

export interface AgentProfile {
  id: string;
  workspaceId: string;
  name: string;
  category: AgentCategory;
  provider?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  temperature?: number | null;   // float (e.g. 0.7); stored as int*100 in DB
  maxTokens?: number | null;
  permissionMode: PermissionMode;
  isDefault: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentProfileInput {
  workspaceId: string;
  name: string;
  category: AgentCategory;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  permissionMode?: PermissionMode;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentProfileInput {
  name?: string;
  category?: AgentCategory;
  provider?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  permissionMode?: PermissionMode;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}
