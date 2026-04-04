import { OpenAPIHono } from '@hono/zod-openapi';

export function createApp() {
  const app = new OpenAPIHono();
  // TODO: Add middleware, routes, error handling
  return app;
}
