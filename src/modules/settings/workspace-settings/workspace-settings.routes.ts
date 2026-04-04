import { OpenAPIHono } from '@hono/zod-openapi';
import { workspaceSettingsController } from './workspace-settings.controller';

export const workspaceSettingsRoutes = new OpenAPIHono();

// GET /settings — return current workspace tool-permission settings
workspaceSettingsRoutes.get('/', (c) => workspaceSettingsController.getSettings(c));

// PATCH /settings — update workspace tool-permission settings
workspaceSettingsRoutes.patch('/', (c) => workspaceSettingsController.updateSettings(c));

// POST /tools/approvals/:approvalId/approve
workspaceSettingsRoutes.post('/tools/approvals/:approvalId/approve', (c) =>
  workspaceSettingsController.approveToolCall(c),
);

// POST /tools/approvals/:approvalId/deny
workspaceSettingsRoutes.post('/tools/approvals/:approvalId/deny', (c) =>
  workspaceSettingsController.denyToolCall(c),
);
