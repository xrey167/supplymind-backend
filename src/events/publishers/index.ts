import { eventBus } from '../bus';
import { Topics } from '../topics';

export function publishTaskStatus(taskId: string, status: string, workspaceId: string) {
  eventBus.publish(Topics.TASK_STATUS, { taskId, status, timestamp: new Date().toISOString(), workspaceId });
}

export function publishTaskTextDelta(taskId: string, delta: string) {
  eventBus.publish(Topics.TASK_TEXT_DELTA, { taskId, delta });
}

export function publishTaskToolCall(taskId: string, toolCall: { id: string; name: string; args: unknown; status: string; result?: unknown }) {
  eventBus.publish(Topics.TASK_TOOL_CALL, { taskId, toolCall });
}

export function publishTaskError(taskId: string, error: string) {
  eventBus.publish(Topics.TASK_ERROR, { taskId, error });
}

export function publishTaskCompleted(taskId: string, output: unknown) {
  eventBus.publish(Topics.TASK_COMPLETED, { taskId, output });
}

export function publishSkillInvoked(name: string, durationMs: number, success: boolean, workspaceId: string) {
  eventBus.publish(Topics.SKILL_INVOKED, { name, durationMs, success, workspaceId });
}
