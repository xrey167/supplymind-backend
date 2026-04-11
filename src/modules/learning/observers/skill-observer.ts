/**
 * Skill Observer
 *
 * Subscribes to Topics.SKILL_INVOKED and writes learning observations
 * to the learning_observations table. Also accumulates skill performance
 * metrics into rolling 24h windows.
 */

import { eventBus } from '../../../events/bus';
import { Topics } from '../../../events/topics';
import { db } from '../../../infra/db/client';
import { learningObservations, skillPerformanceMetrics } from '../../../infra/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { logger } from '../../../config/logger';

let registered = false;

export function _resetSkillObserver() {
  registered = false;
}

export function initSkillObserver(bus = eventBus) {
  if (registered) return;
  registered = true;

  bus.subscribe(Topics.SKILL_INVOKED, async (event) => {
    const data = event.data as {
      name: string;
      workspaceId?: string;
      pluginId?: string;
      durationMs?: number;
      success?: boolean;
      error?: string;
    };

    if (!data.workspaceId) return;

    try {
      // Write raw observation
      await db.insert(learningObservations).values({
        workspaceId: data.workspaceId,
        pluginId: data.pluginId ?? null,
        observationType: data.success === false ? 'skill_failure' : 'skill_success',
        signalStrength: data.success === false ? 1.0 : 0.5,
        payload: {
          skillId: data.name,
          durationMs: data.durationMs,
          success: data.success ?? true,
          error: data.error,
        },
        sourceTopic: Topics.SKILL_INVOKED,
      });

      // Update rolling 24h performance window
      const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const existing = await db
        .select()
        .from(skillPerformanceMetrics)
        .where(and(
          eq(skillPerformanceMetrics.workspaceId, data.workspaceId),
          eq(skillPerformanceMetrics.skillId, data.name),
          gte(skillPerformanceMetrics.windowStart, windowStart),
        ))
        .limit(1);

      if (existing.length > 0) {
        const row = existing[0]!;
        const newCount = row.invocationCount + 1;
        const newSuccess = row.successCount + (data.success !== false ? 1 : 0);
        const newFailure = row.failureCount + (data.success === false ? 1 : 0);
        const prevAvg = row.avgLatencyMs ?? 0;
        const newAvg = data.durationMs
          ? (prevAvg * row.invocationCount + data.durationMs) / newCount
          : prevAvg;

        await db
          .update(skillPerformanceMetrics)
          .set({
            invocationCount: newCount,
            successCount: newSuccess,
            failureCount: newFailure,
            avgLatencyMs: newAvg,
            lastFailureReason: data.success === false ? (data.error ?? 'unknown') : row.lastFailureReason,
          })
          .where(eq(skillPerformanceMetrics.id, row.id));
      } else {
        await db.insert(skillPerformanceMetrics).values({
          workspaceId: data.workspaceId,
          skillId: data.name,
          pluginId: data.pluginId ?? null,
          invocationCount: 1,
          successCount: data.success !== false ? 1 : 0,
          failureCount: data.success === false ? 1 : 0,
          avgLatencyMs: data.durationMs ?? null,
          lastFailureReason: data.success === false ? (data.error ?? 'unknown') : null,
          windowStart,
          windowEnd,
        });
      }
    } catch (err) {
      logger.warn({ skillId: data.name, error: err }, 'Skill observer failed to record');
    }
  });
}
