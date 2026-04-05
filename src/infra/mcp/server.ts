import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { nanoid } from 'nanoid';
import { execute, resolveAuth } from '../../core/gateway';
import type { GatewayContext, GatewayEvent } from '../../core/gateway';
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Transport & session management
// ---------------------------------------------------------------------------

const sessions = new Map<string, {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  context: GatewayContext;
  lastActivity: number;
}>();

// Reap idle MCP sessions every 5 minutes (idle = no activity for 30 min)
const SESSION_IDLE_MS = 30 * 60 * 1000;
const sessionReaper = setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActivity > SESSION_IDLE_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(sid);
      logger.info({ sessionId: sid }, 'Reaped idle MCP session');
    }
  }
}, 5 * 60 * 1000);
// Don't block process exit
if (typeof sessionReaper === 'object' && 'unref' in sessionReaper) (sessionReaper as any).unref();

// ---------------------------------------------------------------------------
// Server factory — one MCP server per session, sharing the same tool handlers
// ---------------------------------------------------------------------------

function createMcpServerInstance(context: GatewayContext): Server {
  const server = new Server(
    { name: 'supplymind', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // --- ListTools: skills + agent tools ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skillsResult = await execute({ op: 'skill.list', params: {}, context });
    const skills = skillsResult.ok ? (skillsResult.value as any[]) : [];

    const agentsResult = await execute({ op: 'agent.list', params: {}, context });
    const agents = agentsResult.ok ? (agentsResult.value as any[]) : [];

    const skillTools = skills.map((s: any) => ({
      name: s.name,
      description: s.description,
      inputSchema: { type: 'object' as const, ...s.inputSchema },
    }));

    const agentTools = agents.map((a: any) => ({
      name: `agent_${a.id}`,
      description: `Talk to agent "${a.name}": ${a.description ?? 'An AI agent'}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          message: { type: 'string', description: 'Message to send to the agent' },
          sessionId: { type: 'string', description: 'Session ID for multi-turn conversation (optional)' },
        },
        required: ['message'],
      },
    }));

    return { tools: [...skillTools, ...agentTools] };
  });

  // --- CallTool: skill invocation OR agent invocation ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Agent tool: agent_<id>
    if (name.startsWith('agent_')) {
      const agentId = name.slice(6); // strip "agent_"
      const message = (args as any)?.message;
      if (!message || typeof message !== 'string') {
        return {
          content: [{ type: 'text' as const, text: 'Error: message is required and must be a string' }],
          isError: true,
        };
      }

      // Collect streaming text for the MCP response
      let accumulated = '';
      const onEvent = (event: GatewayEvent) => {
        if (event.type === 'text_delta') {
          accumulated += (event.data as any).delta ?? '';
        }
      };

      const agentCtx: GatewayContext = {
        ...context,
        onEvent,
        sessionId: (args as any)?.sessionId,
      };

      const result = await execute({
        op: 'agent.invoke',
        params: { agentId, message },
        context: agentCtx,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
          isError: true,
        };
      }

      // If we accumulated streaming text, use that; otherwise use the task result
      const taskResult = result.value as any;
      const output = accumulated || extractTextFromTask(taskResult);

      return { content: [{ type: 'text' as const, text: output }] };
    }

    // Skill tool: direct invocation via gateway
    const result = await execute({
      op: 'skill.invoke',
      params: { name, args: args ?? {} },
      context,
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${result.error.message}` }],
        isError: true,
      };
    }

    const text = typeof result.value === 'string'
      ? result.value
      : JSON.stringify(result.value, null, 2);

    return { content: [{ type: 'text' as const, text }] };
  });

  return server;
}

// ---------------------------------------------------------------------------
// HTTP handler — mount in Hono as app.all('/mcp', handleMcpRequest)
// ---------------------------------------------------------------------------

export async function handleMcpRequest(request: Request): Promise<Response> {
  // --- Auth ---
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  let context: GatewayContext;

  if (token) {
    const identity = await resolveAuth(token);
    if (!identity) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    context = {
      callerId: identity.callerId,
      workspaceId: identity.workspaceId,
      callerRole: identity.callerRole,
    };
  } else {
    // Dev mode: allow unauthenticated access with default context
    context = {
      callerId: 'mcp-anonymous',
      workspaceId: 'default',
      callerRole: 'operator',
    };
    logger.warn('MCP request without auth — using default context (dev mode only)');
  }

  // --- Session resolution ---
  const sessionId = request.headers.get('mcp-session-id');

  if (sessionId && sessions.has(sessionId)) {
    // Existing session
    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    return session.transport.handleRequest(request);
  }

  if (request.method === 'POST' && !sessionId) {
    // New session — create transport + server
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => nanoid(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server, context, lastActivity: Date.now() });
        logger.info({ sessionId: sid, callerId: context.callerId }, 'MCP session initialized');
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        logger.info({ sessionId: sid }, 'MCP session closed');
      },
    });

    const server = createMcpServerInstance(context);
    await server.connect(transport);

    return transport.handleRequest(request);
  }

  if (request.method === 'DELETE' && sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      await session.transport.close();
      sessions.delete(sessionId);
    }
    return new Response(null, { status: 204 });
  }

  // GET for SSE or unknown session
  if (sessionId && !sessions.has(sessionId)) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Bad request' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTextFromTask(task: any): string {
  if (!task) return 'No response';

  // Try artifacts first
  if (task.artifacts?.length > 0) {
    const texts = task.artifacts
      .flatMap((a: any) => a.parts ?? [])
      .filter((p: any) => p.kind === 'text')
      .map((p: any) => p.text);
    if (texts.length > 0) return texts.join('\n');
  }

  // Try history (last agent message)
  if (task.history?.length > 0) {
    const lastAgent = [...task.history].reverse().find((m: any) => m.role === 'agent');
    if (lastAgent) {
      const texts = lastAgent.parts
        .filter((p: any) => p.kind === 'text')
        .map((p: any) => p.text);
      if (texts.length > 0) return texts.join('\n');
    }
  }

  return typeof task === 'string' ? task : JSON.stringify(task, null, 2);
}

/** Get active session count (for monitoring) */
export function getMcpSessionCount(): number {
  return sessions.size;
}
