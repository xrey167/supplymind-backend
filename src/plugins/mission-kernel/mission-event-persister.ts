import { eventBus } from '../../events/bus';
import { missionEventsRepo } from '../../modules/missions/mission-events.repo';
import { logger } from '../../config/logger';

/**
 * Subscribes to all `mission.#` events and persists them to the
 * `mission_events` table for audit trail and replay.
 *
 * Returns an unsubscribe function.
 */
export function registerMissionEventPersister(): () => void {
  const id = eventBus.subscribe(
    'mission.#',
    async (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;

      const workspaceId = data.workspaceId as string | undefined;
      const missionRunId = (data.missionRunId ?? data.missionId) as string | undefined;

      if (!workspaceId || !missionRunId) return;

      try {
        await missionEventsRepo.insert({
          workspaceId,
          eventType: event.topic,
          resourceType: 'mission_run',
          resourceId: missionRunId,
          payload: data,
        });
      } catch (err) {
        logger.error({ topic: event.topic, missionRunId, err }, 'mission-event-persister: failed to persist event');
      }
    },
    { name: 'mission-event-persister' },
  );

  return () => { eventBus.unsubscribe(id); };
}
