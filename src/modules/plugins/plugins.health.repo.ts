import { db } from '../../infra/db/client';
import { pluginHealthChecks } from '../../infra/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { HealthCheckRow } from './plugins.types';

export const pluginHealthRepo = {
  async create(data: {
    installationId: string;
    status: 'healthy' | 'degraded' | 'unreachable';
    latencyMs?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<HealthCheckRow> {
    const [row] = await db.insert(pluginHealthChecks).values({
      installationId: data.installationId,
      status: data.status,
      latencyMs: data.latencyMs,
      error: data.error,
      metadata: data.metadata ?? {},
    }).returning();
    return row as unknown as HealthCheckRow;
  },

  async getLatest(installationId: string): Promise<HealthCheckRow | undefined> {
    const [row] = await db.select().from(pluginHealthChecks)
      .where(eq(pluginHealthChecks.installationId, installationId))
      .orderBy(desc(pluginHealthChecks.checkedAt))
      .limit(1);
    return row as unknown as HealthCheckRow | undefined;
  },
};
