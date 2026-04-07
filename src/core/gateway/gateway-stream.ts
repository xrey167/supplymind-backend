import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import type { GatewayEvent, OnGatewayEvent, GatewayEventType } from './gateway.types';

/** Maps EventBus topic → GatewayEvent type */
const TOPIC_TO_EVENT: Record<string, GatewayEventType> = {
  [Topics.TASK_STATUS]: 'status',
  [Topics.TASK_TEXT_DELTA]: 'text_delta',
  [Topics.TASK_THINKING_DELTA]: 'thinking_delta',
  [Topics.TASK_TOOL_CALL]: 'tool_call',
  [Topics.TASK_ARTIFACT]: 'artifact',
  [Topics.TASK_ROUND_COMPLETED]: 'round_completed',
  [Topics.TASK_ERROR]: 'error',
  [Topics.TASK_COMPLETED]: 'done',
  [Topics.TOOL_APPROVAL_REQUESTED]: 'approval_required',
  [Topics.TASK_INPUT_REQUIRED]: 'input_required',
};

const WATCHED_TOPICS = Object.keys(TOPIC_TO_EVENT);

/**
 * Subscribe to EventBus task topics for a given taskId and pipe them as
 * GatewayEvents to the `onEvent` callback. Returns an unsubscribe function.
 *
 * Automatically unsubscribes when the task reaches a terminal state
 * (completed, failed, canceled).
 */
export function bridgeTaskEvents(taskId: string, onEvent: OnGatewayEvent, bus = eventBus): () => void {
  const subIds: string[] = [];

  for (const topic of WATCHED_TOPICS) {
    const eventType = TOPIC_TO_EVENT[topic];
    const subId = bus.subscribe(topic, (busEvent) => {
      const data = busEvent.data as Record<string, unknown>;
      if (data.taskId !== taskId) return;

      const gatewayEvent: GatewayEvent = { type: eventType, data };
      onEvent(gatewayEvent);

      // Auto-cleanup on terminal events
      if (eventType === 'done' || eventType === 'error') {
        cleanup();
      }
    }, { name: `gateway:stream:${taskId}:${topic}` });

    subIds.push(subId);
  }

  // Also catch cancellation
  const cancelSubId = bus.subscribe(Topics.TASK_CANCELED, (busEvent) => {
    const data = busEvent.data as Record<string, unknown>;
    if (data.taskId !== taskId) return;
    onEvent({ type: 'status', data: { taskId, status: 'canceled' } });
    cleanup();
  }, { name: `gateway:stream:${taskId}:canceled` });
  subIds.push(cancelSubId);

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const id of subIds) {
      bus.unsubscribe(id);
    }
  }

  return cleanup;
}
