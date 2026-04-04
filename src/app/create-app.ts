import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { wsServer } from '../infra/realtime/ws-server';
import { initEventConsumers } from '../events/consumers';
import { errorHandler } from '../api/middlewares/error-handler';
import { publicRoutes } from '../api/routes/public';
import { workspaceRoutes } from '../api/routes/workspace';

export function createApp() {
  const app = new OpenAPIHono();

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

  // Initialize subsystems
  wsServer.init();
  initEventConsumers();

  return app;
}

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
