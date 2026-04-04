import type { Result } from '../../core/result';
import type { ToolDefinition } from '../../infra/ai/types';

export type SkillProviderType = "builtin" | "worker" | "plugin" | "mcp" | "inline";

export interface Skill {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  providerType: SkillProviderType;
  priority: number;
  handler: (args: unknown) => Promise<Result<unknown>>;
}

export interface SkillProvider {
  type: SkillProviderType;
  priority: number;
  loadSkills(): Promise<Skill[]>;
}

export interface DispatchContext {
  callerId: string;
  workspaceId: string;
  callerRole: string;
  traceId?: string;
}

export type DispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  context: DispatchContext,
) => Promise<Result<unknown>>;
