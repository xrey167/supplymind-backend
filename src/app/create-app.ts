import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { wsServer } from '../infra/realtime/ws-server';
import { initEventConsumers } from '../events/consumers';

export function createApp() {
  const app = new OpenAPIHono();

  // Middleware
  app.use('*', cors());
  app.use('*', honoLogger());

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Initialize subsystems
  wsServer.init();
  initEventConsumers();

  // Routes will be mounted in Phase 7

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
