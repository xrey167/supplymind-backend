import { Novu } from '@novu/api';
import { logger } from '../../config/logger';

let client: Novu | null = null;

export function getNovuClient(): Novu | null {
  const apiKey = Bun.env.NOVU_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Novu({ secretKey: apiKey });
  return client;
}

export async function triggerNotification(
  workflowId: WorkflowId,
  subscriberId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const novu = getNovuClient();
  if (!novu) {
    logger.warn({ workflowId }, 'Novu not configured — skipping notification');
    return;
  }
  try {
    await novu.trigger({ name: workflowId, to: { subscriberId }, payload });
  } catch (err) {
    logger.error({ workflowId, subscriberId, err }, 'Novu trigger failed');
  }
}

export const NovuWorkflows = {
  AGENT_FAILURE: 'agent-failure',
  TASK_COMPLETED: 'task-completed',
  API_KEY_CREATED: 'api-key-created',
  WORKSPACE_INVITATION: 'workspace-invitation',
} as const;

export type WorkflowId = typeof NovuWorkflows[keyof typeof NovuWorkflows];
