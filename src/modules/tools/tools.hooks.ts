import type { Result } from '../../core/result';

export interface HookResult {
  allow: boolean;
  modifiedArgs?: unknown;
  reason?: string;
}

export type BeforeExecuteHook = (
  args: unknown,
  ctx: { callerId: string; workspaceId: string; traceId?: string },
) => Promise<HookResult>;

export type AfterExecuteHook = (
  args: unknown,
  result: Result<unknown>,
  ctx: { callerId: string; workspaceId: string; traceId?: string },
) => Promise<void>;

interface ToolHooks {
  beforeExecute?: BeforeExecuteHook;
  afterExecute?: AfterExecuteHook;
}

class HooksRegistry {
  private hooks = new Map<string, ToolHooks>();

  set(toolName: string, hooks: ToolHooks): void {
    this.hooks.set(toolName, hooks);
  }

  get(toolName: string): ToolHooks | undefined {
    return this.hooks.get(toolName);
  }

  delete(toolName: string): void {
    this.hooks.delete(toolName);
  }

  clear(): void {
    this.hooks.clear();
  }
}

export const hooksRegistry = new HooksRegistry();
