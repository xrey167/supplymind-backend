import { createApp } from '../../../src/app/create-app';
import type { OpenAPIHono } from '@hono/zod-openapi';

let _app: OpenAPIHono | null = null;

/**
 * Return the Hono app singleton.
 * createApp() wires all routes but does NOT call initSubsystems(),
 * so no BullMQ workers, Redis bridges, or MCP clients are started.
 */
export async function getTestApp(): Promise<OpenAPIHono> {
  if (!_app) {
    _app = await createApp();
  }
  return _app;
}
