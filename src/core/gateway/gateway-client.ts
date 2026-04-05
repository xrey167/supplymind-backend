import { execute } from './gateway';
import { bridgeTaskEvents } from './gateway-stream';
import type { GatewayContext, GatewayEvent, GatewayResult } from './gateway.types';
import type { Role } from '../security';

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

  /**
   * Streaming variant — returns an AsyncGenerator of GatewayEvents.
   * Sends a task and yields events as they arrive until done/error.
   */
  async *streamTask(agentId: string, message: string, opts?: { sessionId?: string }): AsyncGenerator<GatewayEvent> {
    const queue: GatewayEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

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

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((r) => { resolve = r; });
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
