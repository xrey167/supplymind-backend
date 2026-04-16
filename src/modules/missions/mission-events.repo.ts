import { db } from '../../infra/db/client';
import { missionEvents } from '../../infra/db/schema';
import { and, eq, or, desc } from 'drizzle-orm';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { MissionEvent } from './missions.types';

type Row = typeof missionEvents.$inferSelect;
type NewRow = typeof missionEvents.$inferInsert;

function toEvent(row: Row): MissionEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    eventType: row.eventType,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    parentResourceId: row.parentResourceId,
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

class MissionEventsRepository extends BaseRepo<typeof missionEvents, Row, NewRow> {
  constructor() { super(missionEvents); }

  async insert(data: {
    workspaceId: string;
    eventType: string;
    resourceType: string;
    resourceId: string;
    parentResourceId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(missionEvents).values({
      workspaceId: data.workspaceId,
      eventType: data.eventType,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      parentResourceId: data.parentResourceId ?? null,
      payload: data.payload ?? {},
    });
  }

  async listByMissionRun(missionRunId: string, workspaceId: string, limit = 50): Promise<MissionEvent[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = await db.select().from(missionEvents)
      .where(
        and(
          eq(missionEvents.workspaceId, workspaceId),
          or(
            eq(missionEvents.resourceId, missionRunId),
            eq(missionEvents.parentResourceId, missionRunId),
          )!,
        ),
      )
      .orderBy(desc(missionEvents.createdAt))
      .limit(safeLimit);
    return rows.map(toEvent);
  }

  override async update(): Promise<never> {
    throw new Error('MissionEventsRepository: event records are immutable');
  }

  override async remove(): Promise<never> {
    throw new Error('MissionEventsRepository: event records cannot be deleted');
  }
}

export const missionEventsRepo = new MissionEventsRepository();
