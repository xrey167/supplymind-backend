import type { Context } from 'hono';
import { workspaceSettingsService } from './workspace-settings.service';
import { updateWorkspaceSettingsSchema } from './workspace-settings.schemas';
import { resolveApproval } from '../../../infra/state/tool-approvals';
import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';

export class WorkspaceSettingsController {
  async getSettings(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const settings = await workspaceSettingsService.getToolSettings(workspaceId);
    return c.json({ data: settings });
  }

  async updateSettings(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const body = await c.req.json();

    const parsed = updateWorkspaceSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid settings input',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        400,
      );
    }

    const settings = await workspaceSettingsService.updateToolSettings(workspaceId, parsed.data);
    return c.json({ data: settings });
  }

  async approveToolCall(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const approvalId = c.req.param('approvalId');

    const resolved = resolveApproval(approvalId, true);
    if (!resolved) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Approval request not found or already resolved' } },
        404,
      );
    }

    eventBus.publish(Topics.TOOL_APPROVAL_RESOLVED, { approvalId, approved: true, workspaceId });
    return c.json({ data: { approvalId, approved: true } });
  }

  async denyToolCall(c: Context) {
    const workspaceId = c.get('workspaceId') as string;
    const approvalId = c.req.param('approvalId');

    const resolved = resolveApproval(approvalId, false);
    if (!resolved) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Approval request not found or already resolved' } },
        404,
      );
    }

    eventBus.publish(Topics.TOOL_APPROVAL_RESOLVED, { approvalId, approved: false, workspaceId });
    return c.json({ data: { approvalId, approved: false } });
  }
}

export const workspaceSettingsController = new WorkspaceSettingsController();
