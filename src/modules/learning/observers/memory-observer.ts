/**
 * Memory Observer
 *
 * Subscribes to MEMORY_APPROVED and MEMORY_REJECTED to capture learning
 * signals about what domain knowledge gets accepted vs. rejected.
 */

import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { logger } from '../../../config/logger';

let registered = false;

export function _resetMemoryObserver() {
  registered = false;
}

export function initMemoryObserver(bus = eventBus, dbClient = db) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.MEMORY_APPROVED, async (event) => {
    const data = event.data as { workspaceId: string; memoryId?: string; type?: string };
    if (!data.workspaceId) return;
    try {
      await dbClient.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        observationType: 'memory_approved',
        signalStrength: 0.7,
        payload: { memoryId: data.memoryId, type: data.type },
        sourceTopic: Topics.MEMORY_APPROVED,
      });
    } catch (err) {
      logger.warn({ error: err }, 'Memory observer (approved) failed');
    }
  });

  bus.subscribe(Topics.MEMORY_REJECTED, async (event) => {
    const data = event.data as { workspaceId: string; memoryId?: string; type?: string; reason?: string };
    if (!data.workspaceId) return;
    try {
      await dbClient.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        observationType: 'memory_rejected',
        signalStrength: 1.0, // rejections are strong negative signals
        payload: { memoryId: data.memoryId, type: data.type, reason: data.reason },
        sourceTopic: Topics.MEMORY_REJECTED,
      });
    } catch (err) {
      logger.warn({ error: err }, 'Memory observer (rejected) failed');
    }
  });
}
