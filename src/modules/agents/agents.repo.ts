import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { agentConfigs } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { CreateAgentInput, UpdateAgentInput } from './agents.types';

type AgentConfigRow = typeof agentConfigs.$inferSelect;
type NewAgentConfig = typeof agentConfigs.$inferInsert;

export class AgentsRepository extends BaseRepo<typeof agentConfigs, AgentConfigRow, NewAgentConfig> {
  constructor() { super(agentConfigs); }

  async findByWorkspace(workspaceId: string) {
    return db.select().from(agentConfigs).where(eq(agentConfigs.workspaceId, workspaceId));
  }

  async create(input: CreateAgentInput): Promise<AgentConfigRow> {
    const rows = await db.insert(agentConfigs).values({
      workspaceId: input.workspaceId,
      name: input.name,
      provider: input.provider,
      mode: input.mode,
      model: input.model,
      systemPrompt: input.systemPrompt,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      toolIds: input.toolIds ?? [],
      metadata: input.metadata ?? {},
    }).returning();
    return rows[0]!;
  }

  async update(id: string, input: UpdateAgentInput): Promise<AgentConfigRow | null> {
    const rows = await db.update(agentConfigs)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agentConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }
}

export const agentsRepo = new AgentsRepository();
