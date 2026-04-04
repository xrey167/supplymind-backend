import { OpenAPIHono } from '@hono/zod-openapi';
import { agentsController } from './agents.controller';

export const AgentsRoutes = new OpenAPIHono();

AgentsRoutes.get('/', (c) => agentsController.list(c));
AgentsRoutes.get('/:id', (c) => agentsController.getById(c));
AgentsRoutes.post('/', (c) => agentsController.create(c));
AgentsRoutes.patch('/:id', (c) => agentsController.update(c));
AgentsRoutes.delete('/:id', (c) => agentsController.remove(c));
