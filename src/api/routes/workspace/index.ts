import { OpenAPIHono } from '@hono/zod-openapi';
import { authMiddleware } from '../../middlewares/auth';
import { workspaceMiddleware } from '../../middlewares/workspace';
import { AgentsRoutes } from '../../../modules/agents';
import { ToolsRoutes } from '../../../modules/tools';
import { SkillsRoutes } from '../../../modules/skills';
import { TasksRoutes } from '../../../modules/tasks';

const workspaceRoutes = new OpenAPIHono();

// All workspace routes require auth + workspace context
workspaceRoutes.use('*', authMiddleware);
workspaceRoutes.use('*', workspaceMiddleware);

// Mount module routes
workspaceRoutes.route('/agents', AgentsRoutes);
workspaceRoutes.route('/tools', ToolsRoutes);
workspaceRoutes.route('/skills', SkillsRoutes);
workspaceRoutes.route('/tasks', TasksRoutes);

export { workspaceRoutes };
