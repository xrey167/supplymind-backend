// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionPriority = 'high' | 'normal' | 'low';

const PRIORITY_ORDER: Record<ActionPriority, number> = { high: 0, normal: 1, low: 2 };

export interface Action<TPayload = unknown> {
  /** Unique action ID — caller-assigned (e.g. nanoid). */
  id: string;
  /** Dot-namespaced action type, e.g. "plugin.sync.start". */
  type: string;
  payload: TPayload;
  workspaceId: string;
  priority?: ActionPriority;
  /**
   * Optional idempotency key.
   * If provided, a second execute() call with the same key returns the cached result
   * instead of running the handler again.
   */
  idempotencyKey?: string;
}

export type ActionHandler<TPayload = unknown, TResult = unknown> = (
  action: Action<TPayload>,
) => Promise<TResult>;

export interface PreHookResult {
  block?: true;
  reason?: string;
}

export interface ActionHook<TPayload = unknown> {
  name: string;
  /**
   * For pre-hooks: return `{ block: true, reason }` to stop the action.
   * Return nothing (void) or omit block to continue.
   * Throw to propagate an error.
   *
   * For post-hooks: receives the action and the handler result.
   * Return value is ignored.
   */
  handler: (action: Action<TPayload>, handlerResult?: unknown) => Promise<PreHookResult | void>;
}

export type ActionResult<T = unknown> =
  | { ok: true; value: T; actionId: string }
  | { ok: false; error: Error; actionId: string };

/** Thrown when a pre-hook blocks action execution. */
export class ActionBlockedError extends Error {
  readonly hookName: string;
  constructor(hookName: string, reason?: string) {
    super(`Action blocked by pre-hook "${hookName}"${reason ? ': ' + reason : ''}`);
    this.name = 'ActionBlockedError';
    this.hookName = hookName;
  }
}

// ---------------------------------------------------------------------------
// ActionPipeline
// ---------------------------------------------------------------------------

/**
 * Generic ordered execution pipeline for discrete platform actions.
 *
 * Flow per action:
 *   1. Check idempotency cache — return cached result if key already seen
 *   2. Run pre-hooks in registration order — any can block execution
 *   3. Execute handler
 *   4. Run post-hooks (receive handler result for side-effects like audit)
 *   5. Cache result if idempotencyKey provided
 *
 * Post-hook errors are swallowed — they must not affect the action result.
 * Idempotency cache is in-process only (not durable across restarts).
 *
 * Usage:
 *   const pipeline = new ActionPipeline();
 *   pipeline.addPreHook({ name: 'auth', handler: async (a) => checkPermissions(a) });
 *   pipeline.addPostHook({ name: 'audit', handler: async (a, result) => logAudit(a, result) });
 *   const result = await pipeline.execute(action, handler);
 */
export class ActionPipeline {
  private preHooks: ActionHook[] = [];
  private postHooks: ActionHook[] = [];
  private idempotencyCache = new Map<string, ActionResult>();

  addPreHook(hook: ActionHook): this {
    this.preHooks.push(hook);
    return this;
  }

  addPostHook(hook: ActionHook): this {
    this.postHooks.push(hook);
    return this;
  }

  removeHook(name: string): this {
    this.preHooks = this.preHooks.filter((h) => h.name !== name);
    this.postHooks = this.postHooks.filter((h) => h.name !== name);
    return this;
  }

  /**
   * Execute a single action through the full pre→handler→post pipeline.
   * Never throws — errors are captured in the returned ActionResult.
   */
  async execute<TPayload, TResult>(
    action: Action<TPayload>,
    handler: ActionHandler<TPayload, TResult>,
  ): Promise<ActionResult<TResult>> {
    // Idempotency check
    if (action.idempotencyKey) {
      const cached = this.idempotencyCache.get(action.idempotencyKey);
      if (cached) return cached as ActionResult<TResult>;
    }

    // Pre-hooks
    for (const hook of this.preHooks) {
      try {
        const hookResult = await hook.handler(action as Action);
        if (hookResult && hookResult.block) {
          const error = new ActionBlockedError(hook.name, hookResult.reason);
          return { ok: false, error, actionId: action.id };
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return { ok: false, error, actionId: action.id };
      }
    }

    // Handler
    let handlerResult: TResult;
    try {
      handlerResult = await handler(action);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { ok: false, error, actionId: action.id };
    }

    // Post-hooks — fire-and-forget; errors must not affect result
    for (const hook of this.postHooks) {
      try {
        await hook.handler(action as Action, handlerResult);
      } catch {
        // intentionally swallowed
      }
    }

    const result: ActionResult<TResult> = { ok: true, value: handlerResult, actionId: action.id };

    if (action.idempotencyKey) {
      this.idempotencyCache.set(action.idempotencyKey, result);
    }

    return result;
  }

  /**
   * Execute a batch of actions.
   * Sorted by priority (high → normal → low), executed sequentially.
   * A failed action does NOT stop the batch — all results are collected.
   */
  async executeBatch<TPayload, TResult>(
    actions: Action<TPayload>[],
    handler: ActionHandler<TPayload, TResult>,
  ): Promise<ActionResult<TResult>[]> {
    const sorted = [...actions].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority ?? 'normal'];
      const pb = PRIORITY_ORDER[b.priority ?? 'normal'];
      return pa - pb;
    });

    const results: ActionResult<TResult>[] = [];
    for (const action of sorted) {
      results.push(await this.execute(action, handler));
    }
    return results;
  }

  /** Clear the idempotency cache (useful in tests). */
  clearIdempotencyCache(): void {
    this.idempotencyCache.clear();
  }
}
