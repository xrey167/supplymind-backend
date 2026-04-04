import { OpenAPIHono } from '@hono/zod-openapi';
import { toolsController } from './tools.controller';

export const ToolsRoutes = new OpenAPIHono();

ToolsRoutes.get('/', (c) => toolsController.list(c));
ToolsRoutes.get('/:id', (c) => toolsController.getById(c));
ToolsRoutes.post('/', (c) => toolsController.create(c));
ToolsRoutes.patch('/:id', (c) => toolsController.update(c));
ToolsRoutes.delete('/:id', (c) => toolsController.remove(c));
