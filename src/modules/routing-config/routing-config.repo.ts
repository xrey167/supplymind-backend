import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaceRoutingConfigs } from '../../infra/db/schema';
import type { RoutingConfig, ProviderEntry, RoutingStrategy } from '../../infra/ai/routing/types';

function rowToConfig(row: typeof workspaceRoutingConfigs.$inferSelect): RoutingConfig {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    strategy: row.strategy as RoutingStrategy,
    providers: (row.providers ?? []) as ProviderEntry[],
    roundRobinCounter: row.roundRobinCounter,
    strictRandomDeck: Array.isArray(row.strictRandomDeck) ? (row.strictRandomDeck as string[]) : undefined,
    updatedAt: row.updatedAt,
  };
}

export const routingConfigRepo = {
  async getForWorkspace(workspaceId: string): Promise<RoutingConfig | null> {
    const rows = await db.select().from(workspaceRoutingConfigs)
      .where(eq(workspaceRoutingConfigs.workspaceId, workspaceId));
    return rows[0] ? rowToConfig(rows[0]) : null;
  },

  async upsert(
    workspaceId: string,
    input: { strategy: RoutingStrategy; providers: ProviderEntry[] },
  ): Promise<RoutingConfig> {
    const [row] = await db
      .insert(workspaceRoutingConfigs)
      .values({ workspaceId, strategy: input.strategy, providers: input.providers })
      .onConflictDoUpdate({
        target: workspaceRoutingConfigs.workspaceId,
        set: { strategy: input.strategy, providers: input.providers, updatedAt: new Date() },
      })
      .returning();
    return rowToConfig(row);
  },

  async incrementRoundRobinCounter(id: string, newCounter: number): Promise<void> {
    await db.update(workspaceRoutingConfigs)
      .set({ roundRobinCounter: newCounter })
      .where(eq(workspaceRoutingConfigs.id, id));
  },

  async updateStrictRandomDeck(id: string, deck: string[]): Promise<void> {
    await db.update(workspaceRoutingConfigs)
      .set({ strictRandomDeck: deck })
      .where(eq(workspaceRoutingConfigs.id, id));
  },
};
