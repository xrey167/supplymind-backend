import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';

export function emitOrchestrationStarted(id: string, workspaceId: string): void {
  eventBus.publish(Topics.ORCHESTRATION_STARTED, { orchestrationId: id, workspaceId });
}

export function emitStepCompleted(orchestrationId: string, stepId: string, status: string): void {
  eventBus.publish(Topics.ORCHESTRATION_STEP_COMPLETED, { orchestrationId, stepId, status });
}

export function emitGateWaiting(orchestrationId: string, stepId: string, prompt: string): void {
  eventBus.publish(Topics.ORCHESTRATION_GATE_WAITING, { orchestrationId, stepId, prompt });
}

export function emitOrchestrationCompleted(id: string, workspaceId: string): void {
  eventBus.publish(Topics.ORCHESTRATION_COMPLETED, { orchestrationId: id, workspaceId });
}

export function emitOrchestrationFailed(id: string, workspaceId: string, error: string): void {
  eventBus.publish(Topics.ORCHESTRATION_FAILED, { orchestrationId: id, workspaceId, error });
}

export function emitOrchestrationCancelled(id: string, workspaceId: string): void {
  eventBus.publish(Topics.ORCHESTRATION_CANCELLED, { orchestrationId: id, workspaceId });
}
