import { initSentry, Sentry } from './infra/observability/sentry';

// Sentry must init before everything else
initSentry();

import { createApp, destroySubsystems, getBunWebSocketHandlers } from './app/create-app';

const port = Number(Bun.env.PORT) || 3001;

const app = await createApp();

const server = Bun.serve({
  fetch: app.fetch,
  websocket: getBunWebSocketHandlers(),
  port,
});

console.log(`Server running on port ${port}`);

// Graceful shutdown
async function shutdown() {
  await destroySubsystems();
  await Sentry.close(2000);
  server.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
