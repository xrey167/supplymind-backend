import { nanoid } from 'nanoid';
import { logger } from '../../config/logger';
import { execute, bridgeTaskEvents } from '../../core/gateway';
import type { GatewayContext, GatewayEvent } from '../../core/gateway';
import type { ServerMessage, ClientMessage, WsClient } from './ws-types';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

class WsServer {
  private clients = new Map<string, WsClient>();
  private heartbeatInterval: Timer | null = null;
  /** Track stream cleanups per client so we can unsubscribe on disconnect */
  private streamCleanups = new Map<string, Set<() => void>>();
  /** EventBus subscription IDs for broadcast subscriptions (unsubscribed on destroy) */
  private subscriptionIds: string[] = [];

  init() {
    // Heartbeat every 30s
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'heartbeat' });
    }, 30_000);

    // Forward task events to subscribed clients
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

    this.subscriptionIds.push(eventBus.subscribe(Topics.TASK_THINKING_DELTA, (event) => {
      const data = event.data as any;
      this.broadcastToSubscribed(`task:${data.taskId}`, {
        type: 'task:thinking_delta', taskId: data.taskId, thinking: data.thinking,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.TASK_ROUND_COMPLETED, (event) => {
      const data = event.data as any;
      this.broadcastToSubscribed(`task:${data.taskId}`, {
        type: 'task:round_completed', taskId: data.taskId, roundId: data.roundId,
        iterationIndex: data.iterationIndex, toolCallCount: data.toolCallCount,
        tokenUsage: data.tokenUsage, totalTokens: data.totalTokens,
      });
    }));

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
        approvalId: data.approvalId, taskId: data.taskId,
        toolName: data.toolName, args: data.args, workspaceId: data.workspaceId,
      });
    }));

    // Forward orchestration events to workspace subscribers
    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_STARTED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status', orchestrationId: data.orchestrationId, status: 'running' as const,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_STEP_COMPLETED, (event) => {
      const data = event.data as { orchestrationId: string; stepId: string; status: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status', orchestrationId: data.orchestrationId,
        status: data.status as any, stepId: data.stepId,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_GATE_WAITING, (event) => {
      const data = event.data as { orchestrationId: string; stepId: string; prompt: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:gate', orchestrationId: data.orchestrationId,
        stepId: data.stepId, prompt: data.prompt,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_COMPLETED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status', orchestrationId: data.orchestrationId, status: 'completed' as const,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_FAILED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string; error: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status', orchestrationId: data.orchestrationId,
        status: 'failed' as const, error: data.error,
      });
    }));

    this.subscriptionIds.push(eventBus.subscribe(Topics.ORCHESTRATION_CANCELLED, (event) => {
      const data = event.data as { orchestrationId: string; workspaceId: string };
      this.broadcastToSubscribed(`workspace:${data.workspaceId}`, {
        type: 'orchestration:status', orchestrationId: data.orchestrationId, status: 'cancelled' as const,
      });
    }));
  }

  handleOpen(ws: any): string {
    const clientId = nanoid();
    this.clients.set(clientId, { id: clientId, ws, subscriptions: new Set() });
    this.streamCleanups.set(clientId, new Set());
    return clientId;
  }

  async handleMessage(clientId: string, raw: string | Buffer) {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const msg: ClientMessage = JSON.parse(typeof raw === 'string' ? raw : raw.toString());

      switch (msg.type) {
        case 'auth':
          await this.handleAuth(client, msg.token);
          break;

        case 'subscribe': {
          const denied: string[] = [];
          const allowed: string[] = [];
          for (const ch of msg.channels) {
            if (!this.requiresAuth(ch)) {
              allowed.push(ch);
            } else if (!client.userId) {
              denied.push(ch);
            } else if (ch.startsWith('workspace:')) {
              const wsId = ch.slice('workspace:'.length);
              if (client.allowedWorkspaceIds?.has(wsId)) allowed.push(ch);
              else denied.push(ch);
            } else {
              allowed.push(ch);
            }
          }
          if (denied.length > 0) {
            this.send(client, { type: 'error', message: `Not authorized to subscribe to: ${denied.join(', ')}` });
          }
          allowed.forEach(ch => client.subscriptions.add(ch));
          break;
        }

        case 'unsubscribe':
          msg.channels.forEach(ch => client.subscriptions.delete(ch));
          break;

        case 'ping':
          this.send(client, { type: 'heartbeat' });
          break;

        case 'task:send':
          await this.handleTaskSend(client, msg);
          break;

        case 'task:cancel':
          await this.handleTaskCancel(client, msg);
          break;

        case 'task:input':
          // Not yet implemented
          logger.warn({ clientId }, 'task:input not yet implemented');
          this.send(client, { type: 'error', message: 'task:input is not yet implemented' });
          break;

        case 'a2a:send':
          await this.handleA2aSend(client, msg);
          break;

        case 'skill:invoke':
          await this.handleSkillInvoke(client, msg);
          break;

        case 'session:resume':
          await this.handleSessionResume(client, msg);
          break;

        case 'memory:approve':
          await this.handleMemoryApprove(client, msg);
          break;

        case 'memory:reject':
          await this.handleMemoryReject(client, msg);
          break;

        case 'orchestration:gate:respond':
          await this.handleOrchGateRespond(client, msg);
          break;
      }
    } catch (err) {
      logger.warn({ clientId, error: err instanceof Error ? err.message : String(err) }, 'WebSocket message parse failed');
      this.send(client, { type: 'error', message: 'Invalid message format' });
    }
  }

  handleClose(clientId: string) {
    // Clean up any active stream subscriptions
    const cleanups = this.streamCleanups.get(clientId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      this.streamCleanups.delete(clientId);
    }
    this.clients.delete(clientId);
  }

  // ---------------------------------------------------------------------------
  // Message handlers — each calls the gateway directly
  // ---------------------------------------------------------------------------

  private async handleTaskSend(client: WsClient, msg: Extract<ClientMessage, { type: 'task:send' }>) {
    if (!msg.agentId) {
      this.send(client, { type: 'error', message: 'Missing agentId in task send request' });
      return;
    }

    const context = this.buildContext(client, (event) => {
      this.forwardGatewayEvent(client, event);
    });

    try {
      const result = await execute({
        op: 'task.send',
        params: {
          agentId: msg.agentId,
          message: this.extractMessageText(msg.messages),
        },
        context,
      });

      if (result.ok && result.value && typeof result.value === 'object' && 'id' in (result.value as any)) {
        const taskId = (result.value as any).id;
        // Subscribe this client to the task channel automatically
        client.subscriptions.add(`task:${taskId}`);
        // Bridge task events to this client via gateway stream
        const cleanup = bridgeTaskEvents(taskId, (event) => {
          this.forwardGatewayEvent(client, event, taskId);
        });
        this.trackCleanup(client.id, cleanup);
        logger.info({ taskId, clientId: client.id, agentId: msg.agentId }, 'Task created from WebSocket');
      } else if (!result.ok) {
        this.send(client, { type: 'error', message: result.error.message });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ clientId: client.id, error: errMsg }, 'Failed to create task from WebSocket');
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleTaskCancel(client: WsClient, msg: Extract<ClientMessage, { type: 'task:cancel' }>) {
    if (!msg.taskId) {
      this.send(client, { type: 'error', message: 'Missing taskId in cancel request' });
      return;
    }

    try {
      const context = this.buildContext(client);
      const result = await execute({ op: 'task.cancel', params: { id: msg.taskId }, context });

      if (result.ok) {
        logger.info({ taskId: msg.taskId, clientId: client.id }, 'Task canceled from WebSocket');
      } else {
        this.send(client, { type: 'error', message: result.error.message });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleA2aSend(client: WsClient, msg: Extract<ClientMessage, { type: 'a2a:send' }>) {
    if (!msg.agentUrl) {
      this.send(client, { type: 'error', message: 'Missing agentUrl in A2A send request' });
      return;
    }

    try {
      // A2A delegation still uses workerRegistry directly — not yet in gateway
      const { workerRegistry } = await import('../a2a/worker-registry');
      await workerRegistry.delegate(msg.agentUrl, { skillId: msg.skillId, args: msg.args });
      logger.info({ clientId: client.id, agentUrl: msg.agentUrl }, 'A2A delegation succeeded');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ clientId: client.id, agentUrl: msg.agentUrl, error: errMsg }, 'Failed to delegate A2A request');
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleSkillInvoke(client: WsClient, msg: Extract<ClientMessage, { type: 'skill:invoke' }>) {
    const { name, args, requestId } = msg;

    if (!name) {
      this.send(client, {
        type: 'skill:result',
        requestId: requestId ?? 'unknown',
        name: 'unknown',
        ok: false,
        error: 'Missing skill name',
        durationMs: 0,
      });
      return;
    }

    const context = this.buildContext(client);
    const start = Date.now();

    try {
      const result = await execute({ op: 'skill.invoke', params: { name, args: args ?? {} }, context });
      const durationMs = Date.now() - start;

      this.send(client, {
        type: 'skill:result',
        requestId: requestId ?? name,
        name,
        ok: result.ok,
        result: result.ok ? result.value : undefined,
        error: result.ok ? undefined : (result.error instanceof Error ? result.error.message : String(result.error)),
        durationMs,
      });
    } catch (error) {
      this.send(client, {
        type: 'skill:result',
        requestId: requestId ?? name,
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
    }
  }

  private async handleSessionResume(client: WsClient, msg: Extract<ClientMessage, { type: 'session:resume' }>) {
    if (!msg.sessionId) {
      this.send(client, { type: 'error', message: 'Missing sessionId in session resume request' });
      return;
    }

    try {
      const context = this.buildContext(client);
      await execute({
        op: 'session.resume',
        params: { sessionId: msg.sessionId, input: msg.input },
        context,
      });
      this.send(client, { type: 'session:resumed', sessionId: msg.sessionId });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleMemoryApprove(client: WsClient, msg: Extract<ClientMessage, { type: 'memory:approve' }>) {
    if (!msg.proposalId) {
      this.send(client, { type: 'error', message: 'Missing proposalId in memory approve request' });
      return;
    }

    try {
      const context = this.buildContext(client);
      await execute({ op: 'memory.approve', params: { proposalId: msg.proposalId }, context });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleMemoryReject(client: WsClient, msg: Extract<ClientMessage, { type: 'memory:reject' }>) {
    if (!msg.proposalId) {
      this.send(client, { type: 'error', message: 'Missing proposalId in memory reject request' });
      return;
    }

    try {
      const context = this.buildContext(client);
      await execute({
        op: 'memory.reject',
        params: { proposalId: msg.proposalId, reason: msg.reason },
        context,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  private async handleOrchGateRespond(client: WsClient, msg: Extract<ClientMessage, { type: 'orchestration:gate:respond' }>) {
    try {
      const context = this.buildContext(client);
      await execute({
        op: 'orchestration.gate.respond',
        params: {
          orchestrationId: msg.orchestrationId,
          stepId: msg.stepId,
          approved: msg.approved,
        },
        context,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.send(client, { type: 'error', message: errMsg });
    }
  }

  // ---------------------------------------------------------------------------
  // Auth helpers
  // ---------------------------------------------------------------------------

  private requiresAuth(channel: string): boolean {
    return channel.startsWith('workspace:');
  }

  private async handleAuth(client: WsClient, token: string) {
    try {
      const { verifyWsToken } = await import('./ws-auth');
      const { userId, workspaceIds } = await verifyWsToken(token);
      client.userId = userId;
      client.allowedWorkspaceIds = workspaceIds;
      this.send(client, { type: 'session:resumed', sessionId: client.id });
    } catch {
      this.send(client, { type: 'error', message: 'Authentication failed' });
    }
  }

  // ---------------------------------------------------------------------------
  // Context & event forwarding
  // ---------------------------------------------------------------------------

  private buildContext(client: WsClient, onEvent?: (event: GatewayEvent) => void): GatewayContext {
    // workspaceId: use the first workspace the client is a member of, or 'default' for unauthenticated
    const workspaceId = client.allowedWorkspaceIds
      ? (client.allowedWorkspaceIds.values().next().value ?? 'default')
      : 'default';
    return {
      callerId: client.userId ?? client.id,
      workspaceId,
      callerRole: 'operator' as const,
      traceId: nanoid(8),
      onEvent,
    };
  }

  /** Convert a GatewayEvent to the appropriate ServerMessage and send to client */
  private forwardGatewayEvent(client: WsClient, event: GatewayEvent, taskId?: string) {
    const data = event.data as Record<string, unknown>;
    const tid = taskId ?? (data.taskId as string);

    switch (event.type) {
      case 'text_delta':
        this.send(client, { type: 'task:text_delta', taskId: tid, delta: data.delta as string });
        break;
      case 'thinking_delta':
        this.send(client, { type: 'task:thinking_delta', taskId: tid, thinking: data.thinking as string });
        break;
      case 'tool_call':
        this.send(client, { type: 'task:tool_call', taskId: tid, toolCall: data as any });
        break;
      case 'status':
        this.send(client, { type: 'task:status', taskId: tid, status: data.status as any });
        break;
      case 'artifact':
        this.send(client, { type: 'task:artifact', taskId: tid, artifact: data });
        break;
      case 'round_completed':
        this.send(client, { type: 'task:round_completed', taskId: tid, ...(data as any) });
        break;
      case 'error':
        this.send(client, { type: 'task:error', taskId: tid, error: (data.error as string) ?? String(data) });
        break;
      case 'done':
        this.send(client, { type: 'task:status', taskId: tid, status: 'completed' });
        break;
      case 'approval_required':
        this.send(client, { type: 'tool:approval_required', ...(data as any) });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Transport helpers
  // ---------------------------------------------------------------------------

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

  private trackCleanup(clientId: string, cleanup: () => void) {
    const set = this.streamCleanups.get(clientId);
    if (set) set.add(cleanup);
  }

  private extractMessageText(messages: unknown[]): string {
    if (!messages || messages.length === 0) return '';
    // Messages may be A2A parts or plain strings
    return messages.map((m: any) => {
      if (typeof m === 'string') return m;
      if (m.content) return m.content;
      if (m.text) return m.text;
      return JSON.stringify(m);
    }).join('\n');
  }

  getClientCount(): number { return this.clients.size; }

  destroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const id of this.subscriptionIds) eventBus.unsubscribe(id);
    this.subscriptionIds = [];
    for (const cleanups of this.streamCleanups.values()) {
      for (const cleanup of cleanups) cleanup();
    }
    this.streamCleanups.clear();
    this.clients.clear();
  }
}

export const wsServer = new WsServer();
