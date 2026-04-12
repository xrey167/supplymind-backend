/**
 * Domain Observer
 *
 * Subscribes to DOMAIN_KNOWLEDGE_UPDATED and writes learning observations
 * to the learning_observations table. This feeds the learning engine with
 * signals about domain knowledge graph changes.
 */

import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { db } from '../../../infra/db/client';
import { learningObservations } from '../../../infra/db/schema';
import { logger } from '../../../config/logger';

let registered = false;

export function _resetDomainObserver() {
  registered = false;
}

export function initDomainObserver(bus = eventBus) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.DOMAIN_KNOWLEDGE_UPDATED, async (event) => {
    const data = event.data as {
      pluginId: string;
      workspaceId?: string;
      changesCount?: number;
      confidence?: number;
    };

    if (!data.workspaceId) return;

    try {
      await db.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        pluginId: data.pluginId ?? null,
        observationType: 'domain_knowledge_update',
        signalStrength: data.confidence ?? 0.5,
        payload: {
          pluginId: data.pluginId,
          changesCount: data.changesCount ?? 0,
          confidence: data.confidence,
        },
        sourceTopic: Topics.DOMAIN_KNOWLEDGE_UPDATED,
      });
    } catch (err) {
      logger.warn({ pluginId: data.pluginId, error: err }, 'Domain observer failed to record');
    }
  });
}
