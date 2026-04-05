import type { SkillProviderType } from '../skills/skills.types';

export type HandlerConfig =
  | { type: 'builtin' }
  | { type: 'mcp'; serverName: string; toolName: string }
  | { type: 'worker'; timeout?: number }
  | { type: 'plugin'; modulePath: string; exportName?: string }
  | { type: 'inline'; code: string }
  | { type: 'agent'; agentId?: string; agentUrl?: string }
  | { type: 'tool'; targetSkillName: string; argsMapping?: Record<string, string> };

export interface ToolDef {
  id: string;
  workspaceId: string | null;
  name: string;
  description: string;
  providerType: string;
  priority: number;
  inputSchema: Record<string, unknown>;
  handlerConfig: HandlerConfig;
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
  handlerConfig?: HandlerConfig;
  enabled?: boolean;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  providerType?: string;
  priority?: number;
  inputSchema?: Record<string, unknown>;
  handlerConfig?: HandlerConfig;
  enabled?: boolean;
}
