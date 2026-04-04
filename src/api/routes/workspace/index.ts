import { OpenAPIHono } from '@hono/zod-openapi';
import { authMiddleware } from '../../middlewares/auth';
import { workspaceMiddleware } from '../../middlewares/workspace';
import { AgentsRoutes } from '../../../modules/agents';
import { ToolsRoutes } from '../../../modules/tools';
import { SkillsRoutes } from '../../../modules/skills';
import { TasksRoutes } from '../../../modules/tasks';
import { CollaborationRoutes } from '../../../modules/collaboration/collaboration.routes';
import { WorkflowRoutes } from '../../../modules/workflows/workflows.routes';
import { sessionsRoutes } from '../../../modules/sessions/sessions.routes';
import { memoryRoutes } from '../../../modules/memory/memory.routes';
import { orchestrationRoutes } from '../../../modules/orchestration/orchestration.routes';
import { agentRegistryRoutes } from '../../../modules/agent-registry/agent-registry.routes';
import { mcpRoutes } from '../../../modules/mcp/mcp.routes';
import { workspaceSettingsRoutes } from '../../../modules/settings/workspace-settings/workspace-settings.routes';

const workspaceRoutes = new OpenAPIHono();

// All workspace routes require auth + workspace context
workspaceRoutes.use('*', authMiddleware);
workspaceRoutes.use('*', workspaceMiddleware);

// Mount module routes
workspaceRoutes.route('/agents', AgentsRoutes);
workspaceRoutes.route('/tools', ToolsRoutes);
workspaceRoutes.route('/skills', SkillsRoutes);
workspaceRoutes.route('/tasks', TasksRoutes);
workspaceRoutes.route('/collaboration', CollaborationRoutes);
workspaceRoutes.route('/workflows', WorkflowRoutes);
workspaceRoutes.route('/sessions', sessionsRoutes);
workspaceRoutes.route('/memory', memoryRoutes);
workspaceRoutes.route('/orchestrations', orchestrationRoutes);
workspaceRoutes.route('/agent-registry', agentRegistryRoutes);
workspaceRoutes.route('/mcp', mcpRoutes);
workspaceRoutes.route('/settings', workspaceSettingsRoutes);

export { workspaceRoutes };
