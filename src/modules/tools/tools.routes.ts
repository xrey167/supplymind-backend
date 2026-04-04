import { OpenAPIHono } from '@hono/zod-openapi';
import { toolsController } from './tools.controller';
import { requireRole } from '../../api/middlewares/auth';
import { Roles } from '../../core/security/rbac';

export const ToolsRoutes = new OpenAPIHono();

ToolsRoutes.get('/', (c) => toolsController.list(c));
ToolsRoutes.get('/:id', (c) => toolsController.getById(c));
ToolsRoutes.post('/', requireRole(Roles.OPERATOR), (c) => toolsController.create(c));
ToolsRoutes.patch('/:id', requireRole(Roles.OPERATOR), (c) => toolsController.update(c));
ToolsRoutes.delete('/:id', requireRole(Roles.ADMIN), (c) => toolsController.remove(c));
