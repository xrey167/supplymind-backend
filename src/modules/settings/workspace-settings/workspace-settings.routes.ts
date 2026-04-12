import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { AppEnv } from '../../../core/types';
import { z } from 'zod';
import { workspaceSettingsService } from './workspace-settings.service';
import { updateWorkspaceSettingsSchema, approvalIdParamSchema } from './workspace-settings.schemas';
import { resolveApproval } from '../../../infra/state/tool-approvals';
import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';

const jsonRes = { content: { 'application/json': { schema: z.object({}).passthrough() } } };
const errRes = (desc: string) => ({ description: desc, ...jsonRes });

const getSettingsRoute = createRoute({
  method: 'get', path: '/',
  responses: { 200: { description: 'Current workspace settings', ...jsonRes } },
});

const updateSettingsRoute = createRoute({
  method: 'patch', path: '/',
  request: { body: { content: { 'application/json': { schema: updateWorkspaceSettingsSchema } } } },
  responses: { 200: { description: 'Updated settings', ...jsonRes } },
});

const approveRoute = createRoute({
  method: 'post', path: '/tools/approvals/{approvalId}/approve',
  request: { params: approvalIdParamSchema },
  responses: { 200: { description: 'Approval granted', ...jsonRes }, 404: errRes('Not found') },
});

const denyRoute = createRoute({
  method: 'post', path: '/tools/approvals/{approvalId}/deny',
  request: { params: approvalIdParamSchema },
  responses: { 200: { description: 'Approval denied', ...jsonRes }, 404: errRes('Not found') },
});

export const workspaceSettingsRoutes = new OpenAPIHono<AppEnv>();

workspaceSettingsRoutes.openapi(getSettingsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const settings = await workspaceSettingsService.getToolSettings(workspaceId);
  return c.json({ data: settings });
});

workspaceSettingsRoutes.openapi(updateSettingsRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const body = c.req.valid('json');
  const settings = await workspaceSettingsService.updateToolSettings(workspaceId, body);
  return c.json({ data: settings });
});

workspaceSettingsRoutes.openapi(approveRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { approvalId } = c.req.valid('param');
  const resolved = resolveApproval(approvalId, workspaceId, true);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Approval request not found or already resolved' } }, 404);
  }
  eventBus.publish(Topics.TOOL_APPROVAL_RESOLVED, { approvalId, approved: true, workspaceId });
  return c.json({ data: { approvalId, approved: true } });
});

workspaceSettingsRoutes.openapi(denyRoute, async (c) => {
  const workspaceId = c.get('workspaceId') as string;
  const { approvalId } = c.req.valid('param');
  const resolved = resolveApproval(approvalId, workspaceId, false);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Approval request not found or already resolved' } }, 404);
  }
  eventBus.publish(Topics.TOOL_APPROVAL_RESOLVED, { approvalId, approved: false, workspaceId });
  return c.json({ data: { approvalId, approved: false } });
});
