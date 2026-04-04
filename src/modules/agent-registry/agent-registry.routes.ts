import { OpenAPIHono } from '@hono/zod-openapi';
import { agentRegistryController } from './agent-registry.controller';

export const agentRegistryRoutes = new OpenAPIHono();

agentRegistryRoutes.post('/', (c) => agentRegistryController.register(c));
agentRegistryRoutes.get('/', (c) => agentRegistryController.list(c));
agentRegistryRoutes.delete('/:agentId', (c) => agentRegistryController.remove(c));
agentRegistryRoutes.post('/:agentId/refresh', (c) => agentRegistryController.refresh(c));
