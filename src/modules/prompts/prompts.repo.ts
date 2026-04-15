import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { prompts } from '../../infra/db/schema';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { Prompt, CreatePromptInput, UpdatePromptInput } from './prompts.types';

type PromptRow = typeof prompts.$inferSelect;
type NewPrompt = typeof prompts.$inferInsert;

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? null,
    content: row.content,
    variables: (row.variables ?? []) as Prompt['variables'],
    tags: (row.tags ?? []) as string[],
    version: row.version,
    isActive: row.isActive,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

export class PromptsRepository extends BaseRepo<typeof prompts, PromptRow, NewPrompt> {
  constructor() { super(prompts); }

  async create(input: CreatePromptInput & { variables?: Prompt['variables']; version?: number }): Promise<Prompt> {
    const rows = await db.insert(prompts).values({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      content: input.content,
      variables: input.variables ?? [],
      tags: input.tags ?? [],
      version: input.version ?? 1,
      createdBy: input.createdBy,
    }).returning();
    return toPrompt(rows[0]!);
  }

  async findById(id: string): Promise<Prompt | null> {
    const rows = await db.select().from(prompts).where(eq(prompts.id, id));
    return rows[0] ? toPrompt(rows[0]) : null;
  }

  async list(workspaceId: string, filter?: { tag?: string; isActive?: boolean; limit?: number; offset?: number }): Promise<Prompt[]> {
    const conditions = [eq(prompts.workspaceId, workspaceId)];

    if (filter?.isActive !== undefined) {
      conditions.push(eq(prompts.isActive, filter.isActive));
    }
    if (filter?.tag) {
      conditions.push(sql`${prompts.tags} @> ${JSON.stringify([filter.tag])}::jsonb`);
    }

    let query = db.select().from(prompts)
      .where(and(...conditions))
      .orderBy(desc(prompts.createdAt))
      .$dynamic();

    if (filter?.limit) {
      query = query.limit(filter.limit);
    }
    if (filter?.offset) {
      query = query.offset(filter.offset);
    }

    const rows = await query;
    return rows.map(toPrompt);
  }

  async update(id: string, input: UpdatePromptInput): Promise<Prompt> {
    const rows = await db.update(prompts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(prompts.id, id))
      .returning();
    return toPrompt(rows[0]!);
  }

  async findByName(workspaceId: string, name: string): Promise<Prompt | null> {
    const rows = await db.select().from(prompts)
      .where(and(
        eq(prompts.workspaceId, workspaceId),
        eq(prompts.name, name),
        eq(prompts.isActive, true),
      ))
      .orderBy(desc(prompts.version))
      .limit(1);
    return rows[0] ? toPrompt(rows[0]) : null;
  }
}

export const promptsRepo = new PromptsRepository();
