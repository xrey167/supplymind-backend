import { and, eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { registeredAgents } from '../../infra/db/schema';
import type { RegisteredAgent } from './agent-registry.types';

function toRegisteredAgent(row: typeof registeredAgents.$inferSelect): RegisteredAgent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    agentCard: row.agentCard as Record<string, unknown>,
    enabled: row.enabled,
    lastDiscoveredAt: row.lastDiscoveredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AgentRegistryRepo {
  async create(data: {
    workspaceId: string;
    url: string;
    agentCard: Record<string, unknown>;
    apiKeyHash?: string;
  }): Promise<RegisteredAgent> {
    const rows = await db
      .insert(registeredAgents)
      .values({
        workspaceId: data.workspaceId,
        url: data.url,
        agentCard: data.agentCard,
        apiKeyHash: data.apiKeyHash ?? null,
        lastDiscoveredAt: new Date(),
      })
      .returning();
    return toRegisteredAgent(rows[0]!);
  }

  async findByWorkspace(workspaceId: string): Promise<RegisteredAgent[]> {
    const rows = await db
      .select()
      .from(registeredAgents)
      .where(eq(registeredAgents.workspaceId, workspaceId));
    return rows.map(toRegisteredAgent);
  }

  async findAll(): Promise<RegisteredAgent[]> {
    const rows = await db.select().from(registeredAgents);
    return rows.map(toRegisteredAgent);
  }

  async findById(id: string): Promise<RegisteredAgent | undefined> {
    const rows = await db
      .select()
      .from(registeredAgents)
      .where(eq(registeredAgents.id, id));
    return rows[0] ? toRegisteredAgent(rows[0]) : undefined;
  }

  async findByWorkspaceAndUrl(workspaceId: string, url: string): Promise<RegisteredAgent | undefined> {
    const rows = await db
      .select()
      .from(registeredAgents)
      .where(and(eq(registeredAgents.workspaceId, workspaceId), eq(registeredAgents.url, url)));
    return rows[0] ? toRegisteredAgent(rows[0]) : undefined;
  }

  async updateDiscoveredAt(id: string, agentCard?: Record<string, unknown>, apiKeyHash?: string): Promise<RegisteredAgent | undefined> {
    const updateData: Partial<typeof registeredAgents.$inferInsert> = {
      lastDiscoveredAt: new Date(),
      updatedAt: new Date(),
    };
    if (agentCard) {
      updateData.agentCard = agentCard;
    }
    if (apiKeyHash !== undefined) {
      updateData.apiKeyHash = apiKeyHash;
    }
    const rows = await db
      .update(registeredAgents)
      .set(updateData)
      .where(eq(registeredAgents.id, id))
      .returning();
    return rows[0] ? toRegisteredAgent(rows[0]) : undefined;
  }

  async disable(id: string): Promise<void> {
    await db
      .update(registeredAgents)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(registeredAgents.id, id));
  }

  async remove(id: string): Promise<void> {
    await db.delete(registeredAgents).where(eq(registeredAgents.id, id));
  }
}

export const agentRegistryRepo = new AgentRegistryRepo();
