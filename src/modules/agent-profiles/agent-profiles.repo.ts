import { eq, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { agentProfiles } from '../../infra/db/schema';
import type { AgentProfile, CreateAgentProfileInput, UpdateAgentProfileInput } from './agent-profiles.types';

type Row = typeof agentProfiles.$inferSelect;

function toProfile(row: Row): AgentProfile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    category: row.category,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    // temperature stored as int*100; convert back to float
    temperature: row.temperature != null ? row.temperature / 100 : null,
    maxTokens: row.maxTokens,
    permissionMode: row.permissionMode ?? 'ask',
    isDefault: row.isDefault ?? false,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AgentProfilesRepository {
  async create(workspaceId: string, input: CreateAgentProfileInput): Promise<AgentProfile> {
    const rows = await db.insert(agentProfiles).values({
      workspaceId,
      name: input.name,
      category: input.category,
      provider: input.provider ?? null,
      model: input.model ?? null,
      systemPrompt: input.systemPrompt ?? null,
      // store temperature as int*100
      temperature: input.temperature != null ? Math.round(input.temperature * 100) : null,
      maxTokens: input.maxTokens ?? null,
      permissionMode: input.permissionMode ?? 'ask',
      isDefault: input.isDefault ?? false,
      metadata: input.metadata ?? {},
    }).returning();
    return toProfile(rows[0]!);
  }

  async findById(id: string): Promise<AgentProfile | null> {
    const rows = await db.select().from(agentProfiles).where(eq(agentProfiles.id, id));
    return rows[0] ? toProfile(rows[0]) : null;
  }

  async findByWorkspace(workspaceId: string, category?: string): Promise<AgentProfile[]> {
    const conditions = category
      ? and(eq(agentProfiles.workspaceId, workspaceId), eq(agentProfiles.category, category as AgentProfile['category']))
      : eq(agentProfiles.workspaceId, workspaceId);
    const rows = await db.select().from(agentProfiles).where(conditions);
    return rows.map(toProfile);
  }

  async findDefault(workspaceId: string, category: string): Promise<AgentProfile | null> {
    const rows = await db.select().from(agentProfiles).where(
      and(
        eq(agentProfiles.workspaceId, workspaceId),
        eq(agentProfiles.category, category as AgentProfile['category']),
        eq(agentProfiles.isDefault, true),
      )
    );
    return rows[0] ? toProfile(rows[0]) : null;
  }

  async update(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile | null> {
    const set: Partial<typeof agentProfiles.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.category !== undefined) set.category = input.category;
    if ('provider' in input) set.provider = input.provider ?? null;
    if ('model' in input) set.model = input.model ?? null;
    if ('systemPrompt' in input) set.systemPrompt = input.systemPrompt ?? null;
    if ('temperature' in input) {
      set.temperature = input.temperature != null ? Math.round(input.temperature * 100) : null;
    }
    if ('maxTokens' in input) set.maxTokens = input.maxTokens ?? null;
    if (input.permissionMode !== undefined) set.permissionMode = input.permissionMode;
    if (input.isDefault !== undefined) set.isDefault = input.isDefault;
    if (input.metadata !== undefined) set.metadata = input.metadata;

    const rows = await db.update(agentProfiles).set(set).where(eq(agentProfiles.id, id)).returning();
    return rows[0] ? toProfile(rows[0]) : null;
  }

  async remove(id: string): Promise<void> {
    await db.delete(agentProfiles).where(eq(agentProfiles.id, id));
  }
}

export const agentProfilesRepo = new AgentProfilesRepository();
