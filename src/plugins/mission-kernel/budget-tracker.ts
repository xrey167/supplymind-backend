import { eventBus } from '../../events/bus';
import { missionsRepo } from '../../modules/missions/missions.repo';
import { logger } from '../../config/logger';
import { MissionTopics } from './topics';

/**
 * Subscribes to `task.completed` events and rolls up AI costs into the
 * parent missionRun. When the run's budget is exhausted, publishes
 * MISSION_BUDGET_EXCEEDED and pauses the run.
 *
 * Returns an unsubscribe function (for clean teardown in tests).
 */
export function registerMissionBudgetTracker(): () => void {
  const id = eventBus.subscribe(
    'task.completed',
    async (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;

      const missionRunId = data.missionRunId as string | undefined;
      const costUsd = data.costUsd as number | undefined;

      if (!missionRunId || typeof costUsd !== 'number' || costUsd <= 0) return;

      const costCents = Math.round(costUsd * 100);

      try {
        const updated = await missionsRepo.updateRunSpent(missionRunId, costCents);
        if (!updated) return;

        if (updated.budgetCents != null && updated.spentCents >= updated.budgetCents) {
          logger.info(
            { missionRunId, spentCents: updated.spentCents, budgetCents: updated.budgetCents },
            'Mission budget exceeded — pausing run',
          );
          await eventBus.publish(MissionTopics.MISSION_BUDGET_EXCEEDED, {
            workspaceId: updated.workspaceId,
            missionRunId,
            budgetCents: updated.budgetCents,
            spentCents: updated.spentCents,
          });
          await missionsRepo.updateRunStatus(missionRunId, 'paused');
        }
      } catch (err) {
        logger.error({ missionRunId, err }, 'budget-tracker: failed to update run spent');
      }
    },
    { name: 'mission-budget-tracker' },
  );

  return () => { eventBus.unsubscribe(id); };
}
