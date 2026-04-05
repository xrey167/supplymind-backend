import { execute } from './gateway';
import { bridgeTaskEvents } from './gateway-stream';
import type { GatewayContext, GatewayEvent, GatewayResult } from './gateway.types';
import type { Role } from '../security';
import type { HookEvent, HookHandler, HookRegistration, HookPayloadMap, TypedHookHandler } from '../hooks/hook-registry';
import type { Result } from '../result';
import { ok } from '../result';
import type { PluginManifest } from '../../modules/plugins/plugin-manifest';

/**
 * Typed programmatic client for the gateway (Agent-to-Code protocol).
 *
 * Wraps `execute()` so that workflows, cron jobs, other services, and tests
 * get a typed API without touching WS/HTTP transports.
 */
export class GatewayClient {
  constructor(private context: GatewayContext) {}

  async sendTask(agentId: string, message: string, opts?: { sessionId?: string; runMode?: 'foreground' | 'background' }) {
    return execute({ op: 'task.send', params: { agentId, message, ...opts }, context: this.context });
  }

  async getTask(id: string) {
    return execute({ op: 'task.get', params: { id }, context: this.context });
  }

  async cancelTask(id: string) {
    return execute({ op: 'task.cancel', params: { id }, context: this.context });
  }

  async listTasks() {
    return execute({ op: 'task.list', params: {}, context: this.context });
  }

  async invokeSkill(name: string, args: Record<string, unknown> = {}) {
    return execute({ op: 'skill.invoke', params: { name, args }, context: this.context });
  }

  async listSkills() {
    return execute({ op: 'skill.list', params: {}, context: this.context });
  }

  async listAgents() {
    return execute({ op: 'agent.list', params: {}, context: this.context });
  }

  async delegateA2A(agentUrl: string, params?: { skillId?: string; args?: Record<string, unknown>; message?: unknown }) {
    return execute({ op: 'a2a.delegate', params: { agentUrl, ...params }, context: this.context });
  }

  async respondToInput(taskId: string, input: unknown) {
    return execute({ op: 'task.input', params: { taskId, input }, context: this.context });
  }

  async respondToGate(orchestrationId: string, stepId: string, approved: boolean) {
    return execute({ op: 'orchestration.gate.respond', params: { orchestrationId, stepId, approved }, context: this.context });
  }

  /** Interrupt the current turn without killing the task. */
  async interruptTask(id: string) {
    return execute({ op: 'task.interrupt', params: { id }, context: this.context });
  }

  /** Respond to a tool approval with optional modified args. */
  async respondToApproval(approvalId: string, approved: boolean, updatedInput?: Record<string, unknown>) {
    return execute({
      op: 'task.input',
      params: { taskId: '', approvalId, approved, updatedInput },
      context: this.context,
    });
  }

  // ---------------------------------------------------------------------------
  // Plug-and-play: Tool registration (customers define tools programmatically)
  // ---------------------------------------------------------------------------

  /**
   * Define a tool that gets registered as a skill.
   * Plug-and-play: customers call this to add tools without touching config.
   *
   * Returns a cleanup function to unregister the tool.
   */
  async tool(definition: {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }): Promise<() => void> {
    const { skillRegistry } = await import('../../modules/skills/skills.registry');
    skillRegistry.register({
      id: `acp:${this.context.workspaceId}:${definition.name}`,
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema ?? { type: 'object', properties: {} },
      providerType: 'inline',
      priority: 5,
      handler: async (args) => {
        const result = await definition.handler(args);
        return ok(result);
      },
    });

    return () => {
      skillRegistry.unregister(definition.name);
    };
  }

  // ---------------------------------------------------------------------------
  // Plug-and-play: Plugin installation (customers install plugin bundles)
  // ---------------------------------------------------------------------------

  /**
   * Install a plugin manifest for this client's workspace.
   * Registers all skills, hooks, and config from the manifest.
   * Returns a cleanup function to uninstall.
   */
  async plugin(manifest: PluginManifest): Promise<() => Promise<void>> {
    const { pluginManager } = await import('../../modules/plugins/plugin-manifest');
    return pluginManager.install(manifest, this.context.workspaceId);
  }

  // ---------------------------------------------------------------------------
  // Plug-and-play: Hook registration (customers subscribe to lifecycle events)
  // ---------------------------------------------------------------------------

  /**
   * Register a lifecycle hook for this client's workspace.
   * Returns a cleanup function to unregister.
   *
   * Type-safe: when a single event is passed, the handler receives
   * the typed payload for that event.
   */
  async onHook<E extends HookEvent>(
    event: E | HookEvent[],
    handler: E extends HookEvent ? TypedHookHandler<E> | HookHandler : HookHandler,
    opts?: { id?: string; provider?: string },
  ): Promise<() => void> {
    const hookId = opts?.id ?? `acp:${this.context.workspaceId}:${Date.now()}`;
    const reg: HookRegistration = {
      id: hookId,
      event,
      handler,
      provider: opts?.provider ?? `acp:${this.context.callerId}`,
    };

    const { lifecycleHooks } = await import('../hooks/hook-registry');
    lifecycleHooks.register(this.context.workspaceId, reg);

    return () => {
      lifecycleHooks.unregister(hookId, this.context.workspaceId);
    };
  }

  /**
   * Streaming variant — returns an AsyncGenerator of GatewayEvents.
   * Sends a task and yields events as they arrive until done/error.
   */
  async *streamTask(agentId: string, message: string, opts?: { sessionId?: string; timeoutMs?: number }): AsyncGenerator<GatewayEvent> {
    const queue: GatewayEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    const streamTimeout = opts?.timeoutMs ?? 600_000; // 10 minutes default

    const streamCtx: GatewayContext = {
      ...this.context,
      onEvent: (event) => {
        queue.push(event);
        if (resolve) { resolve(); resolve = null; }
        if (event.type === 'done' || event.type === 'error') done = true;
      },
    };

    const result = await execute({
      op: 'task.send',
      params: { agentId, message, ...opts },
      context: streamCtx,
    });

    if (!result.ok) {
      yield { type: 'error', data: { error: result.error.message } };
      return;
    }

    // Also bridge EventBus events for this task
    const taskId = (result.value as any)?.id;
    let cleanup: (() => void) | undefined;
    if (taskId) {
      cleanup = bridgeTaskEvents(taskId, (event) => {
        queue.push(event);
        if (resolve) { resolve(); resolve = null; }
        if (event.type === 'done' || event.type === 'error') done = true;
      });
    }

    const deadline = Date.now() + streamTimeout;

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (Date.now() >= deadline) {
          yield { type: 'error', data: { error: 'Stream timed out' } };
          return;
        } else {
          const remaining = deadline - Date.now();
          await Promise.race([
            new Promise<void>((r) => { resolve = r; }),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), remaining)),
          ]).catch(() => {
            done = true;
            queue.push({ type: 'error', data: { error: 'Stream timed out' } });
          });
        }
      }
    } finally {
      cleanup?.();
    }
  }
}

/** Factory for creating a GatewayClient with minimal config. */
export function createGatewayClient(opts: {
  callerId: string;
  workspaceId: string;
  callerRole?: Role;
}): GatewayClient {
  return new GatewayClient({
    callerId: opts.callerId,
    workspaceId: opts.workspaceId,
    callerRole: opts.callerRole ?? 'operator',
  });
}
