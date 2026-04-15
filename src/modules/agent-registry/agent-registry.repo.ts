import { and, eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { registeredAgents } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { RegisteredAgent } from './agent-registry.types';
import type { AgentCard } from '../../engine/a2a/types';

type Row = typeof registeredAgents.$inferSelect;
type NewRow = typeof registeredAgents.$inferInsert;

function toRegisteredAgent(row: Row): RegisteredAgent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    agentCard: row.agentCard as AgentCard,
    enabled: row.enabled,
    lastDiscoveredAt: row.lastDiscoveredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AgentRegistryRepo extends BaseRepo<typeof registeredAgents, Row, NewRow> {
  constructor() { super(registeredAgents); }

  async registerAgent(data: {
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

  async listRegistered(filters?: Partial<Row>): Promise<RegisteredAgent[]> {
    const rows = await super.findAll(filters);
    return rows.map(toRegisteredAgent);
  }

  async findAgentById(id: string): Promise<RegisteredAgent | null> {
    const rows = await db
      .select()
      .from(registeredAgents)
      .where(eq(registeredAgents.id, id));
    return rows[0] ? toRegisteredAgent(rows[0]) : null;
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
}

export const agentRegistryRepo = new AgentRegistryRepo();
