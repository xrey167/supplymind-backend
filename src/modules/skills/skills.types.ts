import type { Result } from '../../core/result';
import type { ToolDefinition } from '../../infra/ai/types';
import type { Role } from '../../core/security';
import type { ToolPermissionMode } from '../settings/workspace-settings/workspace-settings.schemas';

export type SkillProviderType = "builtin" | "worker" | "plugin" | "mcp" | "inline" | "agent" | "tool";

/** Optional hints that flow through to ToolDefinition when skills are converted to tools */
export interface SkillToolHints {
  strict?: boolean;
  cacheable?: boolean;
  eagerInputStreaming?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  providerType: SkillProviderType;
  priority: number;
  handler: (args: Record<string, unknown>, context?: DispatchContext) => Promise<Result<unknown>>;
  toolHints?: SkillToolHints;
}

export interface SkillProvider {
  type: SkillProviderType;
  priority: number;
  loadSkills(): Promise<Skill[]>;
}

export interface DispatchContext {
  callerId: string;
  workspaceId: string;
  callerRole: Role;
  traceId?: string;
  signal?: AbortSignal;
  taskId?: string;
  cachedPermissionMode?: ToolPermissionMode;
}

export type DispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  context: DispatchContext,
) => Promise<Result<unknown>>;
