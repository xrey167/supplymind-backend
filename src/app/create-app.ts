import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { wsServer } from '../infra/realtime/ws-server';
import { errorHandler } from '../api/middlewares/error-handler';
import { publicRoutes } from '../api/routes/public';
import { workspaceRoutes } from '../api/routes/workspace';
import { handleMcpRequest } from '../infra/mcp/server';
import { clerkWebhookRoutes } from '../api/routes/webhooks/clerk';
import { WorkspacesRoutes } from '../modules/workspaces';
import { invitationRoutes } from '../api/routes/invitations';
import { initSubsystems, destroySubsystems } from './bootstrap';
import { healthService } from '../modules/health/health.service';

export async function createApp() {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: result.error.flatten().fieldErrors,
          },
        }, 400);
      }
    },
  });

  // Security headers — all routes
  app.use('*', secureHeaders({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    xFrameOptions: 'DENY',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains',
    referrerPolicy: 'strict-origin-when-cross-origin',
  }));

  // CORS — env-configurable origins
  const allowedOrigins = Bun.env.CORS_ALLOWED_ORIGINS
    ? Bun.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (allowedOrigins.includes('*')) return origin;
      return allowedOrigins.includes(origin) ? origin : null;
    },
    credentials: true,
  }));

  app.use('*', honoLogger());

  // Error handler
  app.onError(errorHandler);

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Readiness probe — checks DB + Redis
  app.get('/readyz', async (c) => {
    const result = await healthService.readiness();
    return c.json(result, result.status === 'ready' ? 200 : 503);
  });

  // Public routes (no auth): /.well-known/agent.json, /a2a
  app.route('/', publicRoutes);

  app.route('/webhooks/clerk', clerkWebhookRoutes);
  app.route('/api/v1/workspace-management', WorkspacesRoutes);
  app.route('/api/v1/invitations', invitationRoutes);

  // Workspace-scoped routes (auth required): /api/v1/workspaces/:workspaceId/*
  app.route('/api/v1/workspaces/:workspaceId', workspaceRoutes);

  // MCP server endpoint (Streamable HTTP) — auth via Bearer token in request
  app.all('/mcp', async (c) => {
    const response = await handleMcpRequest(c.req.raw);
    return response;
  });

  // Initialize all subsystems (skills, WS, event consumers, Redis, MCP)
  await initSubsystems();

  return app;
}

export { destroySubsystems };

// Bun.serve WebSocket handlers — used in src/index.ts
export function getBunWebSocketHandlers() {
  return {
    open(ws: any) {
      const clientId = wsServer.handleOpen(ws);
      ws.data = { ...ws.data, clientId };
    },
    message(ws: any, msg: string | Buffer) {
      wsServer.handleMessage(ws.data.clientId, msg);
    },
    close(ws: any) {
      wsServer.handleClose(ws.data.clientId);
    },
  };
}
