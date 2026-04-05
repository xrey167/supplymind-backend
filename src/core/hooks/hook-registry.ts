/**
 * Pluggable lifecycle hook registry.
 *
 * Customers can register hooks per workspace (multi-tenant) or globally.
 * Hooks fire at specific lifecycle points (pre/post tool use, task events, etc.).
 * Each hook can modify data flowing through (e.g., tool args) or block execution.
 *
 * Design principles:
 * - Plug-and-play: register via GatewayClient or at startup
 * - Multi-provider: each workspace has its own hook set
 * - Non-blocking by default: hook errors don't kill the pipeline (logged + swallowed)
 * - Ordered: hooks run in registration order within a workspace
 */
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Hook event types — extensible, customers can listen to any of these
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'task_interrupted'
  | 'approval_requested'
  | 'approval_resolved'
  | 'input_required'
  | 'input_received'
  | 'agent_start'
  | 'agent_stop'
  | 'session_start'
  | 'session_end';

// ---------------------------------------------------------------------------
// Typed payloads per event — customers get type safety on what they receive
// ---------------------------------------------------------------------------

export interface HookPayloadMap {
  pre_tool_use: { name: string; args: Record<string, unknown> };
  post_tool_use: { name: string; args: Record<string, unknown>; result: { ok: boolean; value?: unknown; error?: unknown } };
  task_created: { taskId: string; agentId: string; message?: string };
  task_completed: { taskId: string; result?: unknown };
  task_failed: { taskId: string; error: string };
  task_interrupted: { taskId: string };
  approval_requested: { approvalId: string; taskId: string; toolName: string; args: unknown };
  approval_resolved: { approvalId: string; approved: boolean; updatedInput?: Record<string, unknown> };
  input_required: { taskId: string; prompt: string };
  input_received: { taskId: string; input: unknown };
  agent_start: { agentId: string; taskId?: string };
  agent_stop: { agentId: string; taskId?: string; reason?: string };
  session_start: { sessionId: string };
  session_end: { sessionId: string; reason?: string };
}

// ---------------------------------------------------------------------------
// Hook handler types
// ---------------------------------------------------------------------------

export interface HookContext {
  workspaceId: string;
  callerId: string;
  taskId?: string;
  traceId?: string;
}

/**
 * Hook handler result. Hooks can:
 * - Allow execution to continue (default)
 * - Block execution with a reason
 * - Modify the payload (e.g., tool args) for downstream consumers
 */
export interface HookResult {
  /** If false, blocks the action. Default: true (allow). */
  allow?: boolean;
  /** Reason for blocking — shown to caller. */
  reason?: string;
  /** Modified payload — replaces the original data for downstream hooks and execution. */
  modifiedPayload?: unknown;
}

/** Generic hook handler (accepts any event payload). */
export type HookHandler = (
  event: HookEvent,
  payload: unknown,
  ctx: HookContext,
) => Promise<HookResult | void>;

/**
 * Typed hook handler for a specific event.
 * Customers use this for compile-time payload safety:
 *
 *   client.onHook('pre_tool_use', async (event, payload, ctx) => {
 *     // payload is typed as { name: string; args: Record<string, unknown> }
 *   });
 */
export type TypedHookHandler<E extends HookEvent> = (
  event: E,
  payload: HookPayloadMap[E],
  ctx: HookContext,
) => Promise<HookResult | void>;

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

export interface HookRegistration {
  id: string;
  event: HookEvent | HookEvent[];
  handler: HookHandler;
  /** Provider name for debugging/admin (e.g., 'my-security-plugin') */
  provider?: string;
}

interface StoredHook {
  id: string;
  events: Set<HookEvent>;
  handler: HookHandler;
  provider: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class LifecycleHookRegistry {
  /** Global hooks (fire for all workspaces) */
  private globalHooks: StoredHook[] = [];
  /** Per-workspace hooks */
  private workspaceHooks = new Map<string, StoredHook[]>();

  /**
   * Register a hook globally (fires for all workspaces).
   */
  registerGlobal(reg: HookRegistration): void {
    this.globalHooks.push(toStored(reg));
  }

  /**
   * Register a hook for a specific workspace.
   * Customers use this to add their own hooks per workspace.
   */
  register(workspaceId: string, reg: HookRegistration): void {
    const hooks = this.workspaceHooks.get(workspaceId) ?? [];
    hooks.push(toStored(reg));
    this.workspaceHooks.set(workspaceId, hooks);
  }

  /**
   * Unregister a hook by ID (searches both global and workspace-scoped).
   */
  unregister(hookId: string, workspaceId?: string): boolean {
    if (workspaceId) {
      const hooks = this.workspaceHooks.get(workspaceId);
      if (hooks) {
        const idx = hooks.findIndex(h => h.id === hookId);
        if (idx !== -1) { hooks.splice(idx, 1); return true; }
      }
    }
    const idx = this.globalHooks.findIndex(h => h.id === hookId);
    if (idx !== -1) { this.globalHooks.splice(idx, 1); return true; }
    return false;
  }

  /**
   * Run all hooks for a given event + workspace.
   * Global hooks run first, then workspace-scoped hooks.
   *
   * Returns the final payload (potentially modified by hooks) and whether
   * execution is allowed to continue.
   */
  async run(
    event: HookEvent,
    payload: unknown,
    ctx: HookContext,
  ): Promise<{ allow: boolean; payload: unknown; reason?: string }> {
    const hooks = this.getHooksForEvent(event, ctx.workspaceId);
    let currentPayload = payload;

    for (const hook of hooks) {
      try {
        const result = await hook.handler(event, currentPayload, ctx);
        if (!result) continue;

        if (result.allow === false) {
          logger.info(
            { event, hookId: hook.id, provider: hook.provider, workspaceId: ctx.workspaceId },
            `Hook blocked execution: ${result.reason ?? 'no reason'}`,
          );
          return { allow: false, payload: currentPayload, reason: result.reason };
        }

        if (result.modifiedPayload !== undefined) {
          currentPayload = result.modifiedPayload;
        }
      } catch (error) {
        // Hook errors are non-blocking — log and continue
        logger.error(
          { event, hookId: hook.id, provider: hook.provider, error: error instanceof Error ? error.message : String(error) },
          'Hook threw — swallowed',
        );
      }
    }

    return { allow: true, payload: currentPayload };
  }

  /**
   * Fire-and-forget: notify hooks without waiting for results.
   * Used for post-execution events where blocking doesn't make sense.
   */
  notify(event: HookEvent, payload: unknown, ctx: HookContext): void {
    const hooks = this.getHooksForEvent(event, ctx.workspaceId);
    for (const hook of hooks) {
      Promise.resolve(hook.handler(event, payload, ctx)).catch((error) => {
        logger.error(
          { event, hookId: hook.id, provider: hook.provider, error: error instanceof Error ? error.message : String(error) },
          'Hook notification threw — swallowed',
        );
      });
    }
  }

  /** List all registered hooks for a workspace (including globals). */
  list(workspaceId?: string): Array<{ id: string; events: HookEvent[]; provider: string }> {
    const result: Array<{ id: string; events: HookEvent[]; provider: string }> = [];
    for (const h of this.globalHooks) {
      result.push({ id: h.id, events: [...h.events], provider: h.provider });
    }
    if (workspaceId) {
      for (const h of this.workspaceHooks.get(workspaceId) ?? []) {
        result.push({ id: h.id, events: [...h.events], provider: h.provider });
      }
    }
    return result;
  }

  /** Clear all hooks for a workspace. */
  clearWorkspace(workspaceId: string): void {
    this.workspaceHooks.delete(workspaceId);
  }

  /** Clear everything (tests). */
  clear(): void {
    this.globalHooks = [];
    this.workspaceHooks.clear();
  }

  private getHooksForEvent(event: HookEvent, workspaceId: string): StoredHook[] {
    const matching: StoredHook[] = [];
    for (const h of this.globalHooks) {
      if (h.events.has(event)) matching.push(h);
    }
    for (const h of this.workspaceHooks.get(workspaceId) ?? []) {
      if (h.events.has(event)) matching.push(h);
    }
    return matching;
  }
}

function toStored(reg: HookRegistration): StoredHook {
  return {
    id: reg.id,
    events: new Set(Array.isArray(reg.event) ? reg.event : [reg.event]),
    handler: reg.handler,
    provider: reg.provider ?? 'unknown',
  };
}

export const lifecycleHooks = new LifecycleHookRegistry();
