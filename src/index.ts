import { createApp, destroySubsystems, getBunWebSocketHandlers } from './app/create-app';

const port = Number(process.env.PORT) || 3001;

const app = await createApp();

const server = Bun.serve({
  fetch: app.fetch,
  websocket: getBunWebSocketHandlers(),
  port,
});

console.log(`Server running on port ${port}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  await destroySubsystems();
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await destroySubsystems();
  server.stop();
  process.exit(0);
});
