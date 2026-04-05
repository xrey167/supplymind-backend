import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { wsServer } from '../infra/realtime/ws-server';
import { errorHandler } from '../api/middlewares/error-handler';
import { publicRoutes } from '../api/routes/public';
import { workspaceRoutes } from '../api/routes/workspace';
import { initSubsystems, destroySubsystems } from './bootstrap';

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

  // Global middleware
  app.use('*', cors());
  app.use('*', honoLogger());

  // Error handler
  app.onError(errorHandler);

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Public routes (no auth): /.well-known/agent.json, /a2a
  app.route('/', publicRoutes);

  // Workspace-scoped routes (auth required): /api/v1/workspaces/:workspaceId/*
  app.route('/api/v1/workspaces/:workspaceId', workspaceRoutes);

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
