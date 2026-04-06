export interface PermissionContext {
  workspaceId: string;
  callerId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  taskId?: string;
  /** Current permission mode for this workspace/session. */
  mode?: PermissionMode;
}

export type PermissionMode =
  | 'default'           // normal — ask on destructive actions
  | 'bypassPermissions' // agent mode — skip all prompts (trusted callers only)
  | 'plan'              // plan mode — read-only, deny writes
  | 'acceptEdits';      // always accept file edits without asking

export type PermissionBehavior = 'allow' | 'deny' | 'ask' | 'passthrough';

export type PermissionResult =
  | { behavior: 'allow';       decisionLayer: string; reason?: string }
  | { behavior: 'deny';        decisionLayer: string; reason: string }
  | { behavior: 'ask';         decisionLayer: string; message: string }
  | { behavior: 'passthrough'; decisionLayer: string };

export interface PermissionLayer {
  /** Unique name for this layer — used in decisionLayer field of results. */
  name: string;
  check(ctx: PermissionContext): Promise<Omit<PermissionResult, 'decisionLayer'>>;
}
