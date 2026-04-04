import type { SkillProviderType } from '../skills/skills.types';

export interface ToolDef {
  id: string;
  workspaceId: string | null;
  name: string;
  description: string;
  providerType: string;
  priority: number;
  inputSchema: Record<string, unknown>;
  handlerConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateToolInput {
  name: string;
  description: string;
  workspaceId?: string | null;
  providerType: string;
  priority?: number;
  inputSchema?: Record<string, unknown>;
  handlerConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  providerType?: string;
  priority?: number;
  inputSchema?: Record<string, unknown>;
  handlerConfig?: Record<string, unknown>;
  enabled?: boolean;
}
