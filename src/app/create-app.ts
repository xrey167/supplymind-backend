import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../core/types';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { wsServer } from '../infra/realtime/ws-server';
import { errorHandler } from '../api/middlewares/error-handler';
import { authMiddleware } from '../api/middlewares/auth';
import { publicRoutes } from '../api/routes/public';
import { workspaceRoutes } from '../api/routes/workspace';
import { handleMcpRequest } from '../infra/mcp/server';
import { clerkWebhookRoutes } from '../api/routes/webhooks/clerk';
import { stripeWebhookRoutes } from '../api/routes/webhooks/stripe';
import { webhookIngestRoute } from '../api/routes/webhooks-ingest';
import { WorkspacesRoutes } from '../modules/workspaces';
import { invitationRoutes } from '../api/routes/invitations';
import { initSubsystems, destroySubsystems } from './bootstrap';
import { healthService } from '../modules/health/health.service';
import { pluginCatalogRoutes } from '../modules/plugins/plugins.catalog.routes';
import { oauthConnectionsRoutes } from '../modules/oauth-connections/oauth-connections.routes';
import { promptInjectionMiddleware } from '../api/middlewares/prompt-injection';

export async function createApp(opts?: { skipSubsystems?: boolean }) {
  const app = new OpenAPIHono<AppEnv>({
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
    contentSecurityPolicy: undefined,
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
  app.route('/webhooks/stripe', stripeWebhookRoutes);
  app.route('/webhooks/ingest', webhookIngestRoute);
  // Auth guard for workspace-management routes (top-level, not workspace-scoped)
  app.use('/api/v1/workspace-management', authMiddleware);
  app.use('/api/v1/workspace-management/*', authMiddleware);
  app.route('/api/v1/workspace-management', WorkspacesRoutes);
  app.route('/api/v1/invitations', invitationRoutes);
  app.route('/api/v1/plugin-catalog', pluginCatalogRoutes);

  // OAuth provider connection routes (authorize, exchange, device-code, poll, status, disconnect)
  app.route('/api/oauth', oauthConnectionsRoutes);

  // Prompt injection guard — applied to all workspace AI calls
  app.use('/api/v1/workspaces/*', promptInjectionMiddleware());

  // Workspace-scoped routes (auth required): /api/v1/workspaces/:workspaceId/*
  app.route('/api/v1/workspaces/:workspaceId', workspaceRoutes);

  // MCP server endpoint (Streamable HTTP) — auth via Bearer token in request
  app.all('/mcp', async (c) => {
    const response = await handleMcpRequest(c.req.raw);
    return response;
  });

  // OpenAPI spec endpoint
  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'SupplyMind API', version: '0.1.0', description: 'Multi-protocol agent orchestration platform' },
  });

  // Initialize all subsystems (skills, WS, event consumers, Redis, MCP)
  if (!opts?.skipSubsystems) {
    await initSubsystems(app);
  }

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
