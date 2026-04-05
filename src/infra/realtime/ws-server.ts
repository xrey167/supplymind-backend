import { nanoid } from 'nanoid';
import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { ServerMessage, ClientMessage, WsClient } from './ws-types';

class WsServer {
  private clients = new Map<string, WsClient>();
  private heartbeatInterval: Timer | null = null;
  private subscriptionIds: string[] = [];

  init() {
    // Start heartbeat every 30s
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'heartbeat' });
    }, 30_000);

    // Subscribe to all task events and forward to matching clients
    const taskTopics = [
      Topics.TASK_STATUS, Topics.TASK_TEXT_DELTA, Topics.TASK_TOOL_CALL,
      Topics.TASK_ARTIFACT, Topics.TASK_ERROR, Topics.TASK_COMPLETED,
    ];
    for (const topic of taskTopics) {
      this.subscriptionIds.push(eventBus.subscribe(topic, (event) => {
        const data = event.data as any;
        this.broadcastToSubscribed(`task:${data.taskId}`, { ...data, type: topic } as any);
      }));
    }

    // Forward TASK_THINKING_DELTA to subscribed clients
    this.subscriptionIds.push(eventBus.subscribe(Topics.TASK_THINKING_DELTA, (event) => {
      const data = event.data as any;
      this.broadcastToSubscribed(`task:${data.taskId}`, {
        type: 'task:thinking_delta',
        taskId: data.taskId,
        thinking: data.thinking,
      });
    }));

    // Forward TASK_ROUND_COMPLETED with token usage to subscribed clients
    this.subscriptionIds.push(eventBus.subscribe(Topics.TASK_ROUND_COMPLETED, (event) => {
      const data = event.data as any;
      this.broadcastToSubscribed(`task:${data.taskId}`, {
        type: 'task:round_completed',
        taskId: data.taskId,
        roundId: data.roundId,
        iterationIndex: data.iterationIndex,
        toolCallCount: data.toolCallCount,
        tokenUsage: data.tokenUsage,
        totalTokens: data.totalTokens,
      });
    }));

    // Subscribe to skill events
    this.subscriptionIds.push(eventBus.subscribe(Topics.SKILL_INVOKED, (event) => {
      this.broadcastToSubscribed('events:skill.*', {
        type: 'event', topic: Topics.SKILL_INVOKED, data: event.data, timestamp: new Date().toISOString(),
      });
    }));

    // Forward tool approval requests to workspace subscribers
    this.subscriptionIds.push(eventBus.subscribe(Topics.TOOL_APPROVAL_REQUESTED, (event) => {
      const data = event.data as { approvalId: string; taskId: string; toolName: string; args: unknown; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'tool:approval_required',
        approvalId: data.approvalId,
        taskId: data.taskId,
        toolName: data.toolName,
        args: data.args,
        workspaceId: data.workspaceId,
      });
    }));

    // Forward orchestration events to workspace subscribers
    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_STARTED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status',
        orchestrationId: data.orchestrationId,
        status: 'running' as const,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_STEP_COMPLETED, (event) => {
      const data = event.data as { orchestrationId: string; stepId: string; status: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status',
        orchestrationId: data.orchestrationId,
        status: data.status as any,
        stepId: data.stepId,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_GATE_WAITING, (event) => {
      const data = event.data as { orchestrationId: string; stepId: string; prompt: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:gate',
        orchestrationId: data.orchestrationId,
        stepId: data.stepId,
        prompt: data.prompt,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_COMPLETED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status',
        orchestrationId: data.orchestrationId,
        status: 'completed' as const,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_FAILED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string; error: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status',
        orchestrationId: data.orchestrationId,
        status: 'failed' as const,
        error: data.error,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_CANCELLED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status',
        orchestrationId: data.orchestrationId,
        status: 'cancelled' as const,
      });
    }));

    // Route skill:result back to the requesting WS client
    this.subscriptionIds.push(eventBus.subscribe('ws.skill.result', (event) => {
      const data = event.data as any;
      const client = this.clients.get(data.clientId);
      if (client) {
        this.send(client, data.message);
      }
    }));
  }

  handleOpen(ws: any): string {
    const clientId = nanoid();
    this.clients.set(clientId, { id: clientId, ws, subscriptions: new Set() });
    return clientId;
  }

  handleMessage(clientId: string, raw: string | Buffer) {
    const client = this.clients.get(clientId);
    if (!client) return;
    try {
      const msg: ClientMessage = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      switch (msg.type) {
        case 'auth':
          this.handleAuth(client, msg.token);
          break;
        case 'subscribe': {
          const denied = msg.channels.filter(ch => this.requiresAuth(ch) && !client.userId);
          if (denied.length > 0) {
            this.send(client, { type: 'error', message: `Authentication required to subscribe to: ${denied.join(', ')}` });
            // Only add channels that don't require auth
            msg.channels.filter(ch => !this.requiresAuth(ch)).forEach(ch => client.subscriptions.add(ch));
          } else {
            msg.channels.forEach(ch => client.subscriptions.add(ch));
          }
          break;
        }
        case 'unsubscribe':
          msg.channels.forEach(ch => client.subscriptions.delete(ch));
          break;
        case 'ping':
          this.send(client, { type: 'heartbeat' });
          break;
        case 'task:send':
          // Will be wired to task-manager in Phase 6
          eventBus.publish('ws.task.send', { clientId, ...msg });
          break;
        case 'task:cancel':
          eventBus.publish('ws.task.cancel', { clientId, taskId: msg.taskId });
          break;
        case 'task:input':
          eventBus.publish('ws.task.input', { clientId, taskId: msg.taskId, input: msg.input });
          break;
        case 'a2a:send':
          eventBus.publish('ws.a2a.send', { clientId, ...msg });
          break;
        case 'skill:invoke':
          eventBus.publish('ws.skill.invoke', { clientId, ...msg });
          break;
      }
    } catch (err) {
      logger.warn({ clientId, error: err instanceof Error ? err.message : String(err) }, 'WebSocket message parse failed');
      this.send(client, { type: 'error', message: 'Invalid message format' });
    }
  }

  handleClose(clientId: string) {
    this.clients.delete(clientId);
  }

  private requiresAuth(channel: string): boolean {
    return channel.startsWith('workspace:');
  }

  private async handleAuth(client: import('./ws-types').WsClient, token: string) {
    try {
      const { verifyWsToken } = await import('./ws-auth');
      const userId = await verifyWsToken(token);
      client.userId = userId;
      // TODO: load workspace memberships here once workspace_members table exists
      this.send(client, { type: 'session:resumed', sessionId: client.id });
    } catch {
      this.send(client, { type: 'error', message: 'Authentication failed' });
    }
  }

  private send(client: WsClient, msg: ServerMessage) {
    try {
      (client.ws as any).send(JSON.stringify(msg));
    } catch (error) {
      logger.warn({ clientId: client.id, error: error instanceof Error ? error.message : String(error) }, 'WS send failed, removing client');
      this.clients.delete(client.id);
    }
  }

  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    const toRemove: string[] = [];
    for (const [id, client] of this.clients) {
      try { (client.ws as any).send(data); } catch (error) {
        logger.warn({ clientId: id, error: error instanceof Error ? error.message : String(error) }, 'WS broadcast failed, removing client');
        toRemove.push(id);
      }
    }
    for (const id of toRemove) this.clients.delete(id);
  }

  broadcastToSubscribed(channel: string, msg: ServerMessage) {
    const data = JSON.stringify(msg);
    const toRemove: string[] = [];
    for (const [id, client] of this.clients) {
      if (this.matchesSubscription(client.subscriptions, channel)) {
        try { (client.ws as any).send(data); } catch (error) {
          logger.warn({ clientId: id, error: error instanceof Error ? error.message : String(error) }, 'WS broadcastToSubscribed failed, removing client');
          toRemove.push(id);
        }
      }
    }
    for (const id of toRemove) this.clients.delete(id);
  }

  private matchesSubscription(subs: Set<string>, channel: string): boolean {
    for (const sub of subs) {
      if (sub === channel) return true;
      if (sub === 'task:*' && channel.startsWith('task:')) return true;
      if (sub.endsWith('.*') && channel.startsWith(sub.slice(0, -1))) return true;
    }
    return false;
  }

  getClientCount(): number { return this.clients.size; }

  destroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const id of this.subscriptionIds) eventBus.unsubscribe(id);
    this.subscriptionIds = [];
    this.clients.clear();
  }
}

export const wsServer = new WsServer();
