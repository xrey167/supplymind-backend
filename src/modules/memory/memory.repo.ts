import { db } from '../../infra/db/client';
import { agentMemories, memoryProposals } from '../../infra/db/schema';
import { eq, and, or, isNull, ilike, desc } from 'drizzle-orm';
import type { AgentMemory, MemoryProposal, SaveMemoryInput, ProposeMemoryInput } from './memory.types';

export const memoryRepo = {
  async save(input: SaveMemoryInput): Promise<AgentMemory> {
    const [row] = await db.insert(agentMemories).values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      type: input.type as any,
      title: input.title,
      content: input.content,
      source: 'explicit' as any,
      metadata: input.metadata ?? {},
      expiresAt: input.expiresAt,
    }).returning();
    return row as unknown as AgentMemory;
  },

  async get(id: string): Promise<AgentMemory | undefined> {
    const [row] = await db.select().from(agentMemories).where(eq(agentMemories.id, id)).limit(1);
    return row as unknown as AgentMemory | undefined;
  },

  async search(query: string, workspaceId: string, agentId?: string, limit = 10): Promise<AgentMemory[]> {
    const agentFilter = agentId
      ? or(eq(agentMemories.agentId, agentId), isNull(agentMemories.agentId))
      : isNull(agentMemories.agentId);

    const pattern = `%${query}%`;
    const rows = await db.select().from(agentMemories)
      .where(and(
        eq(agentMemories.workspaceId, workspaceId),
        agentFilter as any,
        or(
          ilike(agentMemories.title, pattern),
          ilike(agentMemories.content, pattern),
        ) as any,
      ))
      .limit(limit);
    return rows as unknown as AgentMemory[];
  },

  async list(workspaceId: string, agentId?: string): Promise<AgentMemory[]> {
    const agentFilter = agentId
      ? or(eq(agentMemories.agentId, agentId), isNull(agentMemories.agentId))
      : undefined;

    const conditions = [eq(agentMemories.workspaceId, workspaceId)];
    if (agentFilter) conditions.push(agentFilter as any);

    const rows = await db.select().from(agentMemories)
      .where(and(...conditions))
      .limit(100);
    return rows as unknown as AgentMemory[];
  },

  async delete(id: string): Promise<boolean> {
    const rows = await db.delete(agentMemories).where(eq(agentMemories.id, id)).returning({ id: agentMemories.id });
    return rows.length > 0;
  },

  async createProposal(input: ProposeMemoryInput): Promise<MemoryProposal> {
    const [row] = await db.insert(memoryProposals).values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      type: input.type as any,
      title: input.title,
      content: input.content,
      evidence: input.evidence,
      sessionId: input.sessionId,
    }).returning();
    return row as unknown as MemoryProposal;
  },

  async getProposal(id: string): Promise<MemoryProposal | undefined> {
    const [row] = await db.select().from(memoryProposals).where(eq(memoryProposals.id, id)).limit(1);
    return row as unknown as MemoryProposal | undefined;
  },

  async approveProposal(proposalId: string): Promise<AgentMemory> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    if (proposal.status !== 'pending') throw new Error(`Proposal is not pending: ${proposalId}`);

    await db.update(memoryProposals)
      .set({ status: 'approved' as any, reviewedAt: new Date() })
      .where(eq(memoryProposals.id, proposalId));

    const [memory] = await db.insert(agentMemories).values({
      workspaceId: proposal.workspaceId,
      agentId: proposal.agentId,
      type: proposal.type as any,
      title: proposal.title,
      content: proposal.content,
      source: 'approved' as any,
      confidence: 1.0,
      metadata: { proposalId, evidence: proposal.evidence },
    }).returning();

    return memory as unknown as AgentMemory;
  },

  async rejectProposal(proposalId: string, reason?: string): Promise<void> {
    await db.update(memoryProposals)
      .set({
        status: 'rejected' as any,
        rejectionReason: reason,
        reviewedAt: new Date(),
      })
      .where(eq(memoryProposals.id, proposalId));
  },

  async updateProposalStatus(proposalId: string, status: string): Promise<void> {
    await db.update(memoryProposals)
      .set({ status: status as any, reviewedAt: new Date() })
      .where(eq(memoryProposals.id, proposalId));
  },

  async listProposals(workspaceId: string, status?: string): Promise<MemoryProposal[]> {
    const conditions = [eq(memoryProposals.workspaceId, workspaceId)];
    if (status) conditions.push(eq(memoryProposals.status, status as any));
    const rows = await db.select().from(memoryProposals)
      .where(and(...conditions))
      .orderBy(desc(memoryProposals.createdAt))
      .limit(100);
    return rows as unknown as MemoryProposal[];
  },

  async getProposalWithWorkspaceCheck(id: string, workspaceId: string): Promise<MemoryProposal | undefined> {
    const [row] = await db.select().from(memoryProposals)
      .where(and(eq(memoryProposals.id, id), eq(memoryProposals.workspaceId, workspaceId)))
      .limit(1);
    return row as unknown as MemoryProposal | undefined;
  },

  async deleteMemoryByProposalId(proposalId: string): Promise<boolean> {
    // Find the memory created from this proposal via metadata.proposalId
    const memories = await db.select({ id: agentMemories.id, metadata: agentMemories.metadata })
      .from(agentMemories)
      .limit(200);
    for (const m of memories) {
      const meta = m.metadata as Record<string, unknown> | null;
      if (meta?.proposalId === proposalId) {
        await db.delete(agentMemories).where(eq(agentMemories.id, m.id));
        return true;
      }
    }
    return false;
  },
};
