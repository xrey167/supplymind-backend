import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { agentConfigs } from '../../infra/db/schema';
import type { CreateAgentInput, UpdateAgentInput } from './agents.types';

export class AgentsRepository {
  async findById(id: string) {
    const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.id, id));
    return rows[0] ?? null;
  }

  async findByWorkspace(workspaceId: string) {
    return db.select().from(agentConfigs).where(eq(agentConfigs.workspaceId, workspaceId));
  }

  async create(input: CreateAgentInput) {
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

  async update(id: string, input: UpdateAgentInput) {
    const rows = await db.update(agentConfigs)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agentConfigs.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async remove(id: string) {
    await db.delete(agentConfigs).where(eq(agentConfigs.id, id));
  }
}

export const agentsRepo = new AgentsRepository();
