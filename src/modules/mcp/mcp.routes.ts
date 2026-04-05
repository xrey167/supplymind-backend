import { OpenAPIHono } from '@hono/zod-openapi';
import { mcpController } from './mcp.controller';

export const mcpRoutes = new OpenAPIHono();

mcpRoutes.get('/', (c) => mcpController.list(c));
mcpRoutes.post('/', (c) => mcpController.create(c));
mcpRoutes.patch('/:mcpId', (c) => mcpController.update(c));
mcpRoutes.delete('/:mcpId', (c) => mcpController.remove(c));
mcpRoutes.post('/:mcpId/test', (c) => mcpController.testConnection(c));
