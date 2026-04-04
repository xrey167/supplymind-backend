import { skillRegistry } from '../skills/skills.registry';
import { memoryService } from './memory.service';
import { ok, err } from '../../core/result';
import type { Skill, DispatchContext } from '../skills/skills.types';

const memorySkills: Skill[] = [
  {
    id: 'remember',
    name: 'remember',
    description: 'Save a fact or observation to persistent memory.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short label for this memory' },
        content: { type: 'string', description: 'The information to remember' },
        type: { type: 'string', enum: ['domain', 'feedback', 'pattern', 'reference'] },
        shared: { type: 'boolean', description: 'If true, visible to all agents in workspace' },
      },
      required: ['title', 'content', 'type'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: unknown, context?: DispatchContext) => {
      try {
        const { title, content, type, shared } = args as any;
        const workspaceId = context?.workspaceId ?? 'default';
        const agentId = shared ? undefined : context?.callerId;
        const memory = await memoryService.save({
          workspaceId, agentId, type, title, content,
        });
        return ok({ memoryId: memory.id, title: memory.title });
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },
  },
  {
    id: 'recall',
    name: 'recall',
    description: 'Search persistent memory for relevant information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: unknown, context?: DispatchContext) => {
      try {
        const { query, limit } = args as any;
        const workspaceId = context?.workspaceId ?? 'default';
        const agentId = context?.callerId;
        const memories = await memoryService.recall({ query, workspaceId, agentId, limit: limit ?? 5 });
        return ok(memories.map((m) => {
          const staleWarning = m.stale ? ` ⚠️ Stale (${m.staleDays} days old)` : '';
          return {
            title: m.title + staleWarning,
            content: m.content,
            type: m.type,
            confidence: m.confidence,
            scope: m.scope,
            stale: m.stale,
            staleDays: m.staleDays,
            updatedAt: m.updatedAt,
          };
        }));
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },
  },
  {
    id: 'propose_memory',
    name: 'propose_memory',
    description: 'Propose a memory for human approval.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string', enum: ['domain', 'feedback', 'pattern', 'reference'] },
        evidence: { type: 'string', description: 'Why you believe this is true' },
      },
      required: ['title', 'content', 'type', 'evidence'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: unknown, context?: DispatchContext) => {
      try {
        const { title, content, type, evidence } = args as any;
        const workspaceId = context?.workspaceId ?? 'default';
        const agentId = context?.callerId ?? 'default';
        const proposal = await memoryService.propose({
          workspaceId, agentId, type, title, content, evidence,
        });
        return ok({ proposalId: proposal.id, status: 'pending', message: 'Memory proposed — awaiting human approval' });
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },
  },
  {
    id: 'forget',
    name: 'forget',
    description: 'Delete a specific memory by ID.',
    inputSchema: {
      type: 'object',
      properties: { memoryId: { type: 'string' } },
      required: ['memoryId'],
    },
    providerType: 'builtin',
    priority: 50,
    handler: async (args: unknown) => {
      try {
        const { memoryId } = args as any;
        const deleted = await memoryService.forget(memoryId);
        return ok({ deleted, memoryId });
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    },
  },
];

export function registerMemorySkills(): void {
  for (const skill of memorySkills) {
    skillRegistry.register(skill);
  }
}
