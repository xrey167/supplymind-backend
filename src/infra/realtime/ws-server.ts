import { nanoid } from 'nanoid';
import { logger } from '../../config/logger';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { ServerMessage, ClientMessage, WsClient } from './ws-types';

class WsServer {
  private clients = new Map<string, WsClient>();
  private heartbeatInterval: Timer | null = null;

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
      eventBus.subscribe(topic, (event) => {
        const data = event.data as any;
        this.broadcastToSubscribed(`task:${data.taskId}`, { ...data, type: topic } as any);
      });
    }

    // Forward TASK_THINKING_DELTA to subscribed clients
    eventBus.subscribe(Topics.TASK_THINKING_DELTA, (event) => {
      const data = event.data as any;
      this.broadcastToSubscribed(`task:${data.taskId}`, {
        type: 'task:thinking_delta',
        taskId: data.taskId,
        thinking: data.thinking,
      });
    });

    // Forward TASK_ROUND_COMPLETED with token usage to subscribed clients
    eventBus.subscribe(Topics.TASK_ROUND_COMPLETED, (event) => {
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
    });

    // Subscribe to skill events
    eventBus.subscribe(Topics.SKILL_INVOKED, (event) => {
      this.broadcastToSubscribed('events:skill.*', {
        type: 'event', topic: Topics.SKILL_INVOKED, data: event.data, timestamp: new Date().toISOString(),
      });
    });

    // Forward tool approval requests to workspace subscribers
    eventBus.subscribe(Topics.TOOL_APPROVAL_REQUESTED, (event) => {
      const data = event.data as { approvalId: string; taskId: string; toolName: string; args: unknown; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'tool:approval_required',
        approvalId: data.approvalId,
        taskId: data.taskId,
        toolName: data.toolName,
        args: data.args,
        workspaceId: data.workspaceId,
      });
    });

    // Route skill:result back to the requesting WS client
    eventBus.subscribe('ws.skill.result', (event) => {
      const data = event.data as any;
      const client = this.clients.get(data.clientId);
      if (client) {
        this.send(client, data.message);
      }
    });
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
        case 'subscribe':
          msg.channels.forEach(ch => client.subscriptions.add(ch));
          break;
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
    this.clients.clear();
  }
}

export const wsServer = new WsServer();
