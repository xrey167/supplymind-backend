export interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface MemoryStore {
  upsert(id: string, text: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>;
  search(query: number[], opts: { limit: number; threshold: number; filter?: Record<string, unknown> }): Promise<SearchResult[]>;
  delete(id: string): Promise<void>;
}

import { db } from '../../infra/db/client';
import { agentMemories } from '../../infra/db/schema';
import { eq, sql } from 'drizzle-orm';

export class PgVectorMemoryStore implements MemoryStore {
  async upsert(id: string, _text: string, embedding: number[], _metadata: Record<string, unknown>): Promise<void> {
    await db.update(agentMemories)
      .set({ embedding: embedding as any, updatedAt: new Date() })
      .where(eq(agentMemories.id, id));
  }

  async search(query: number[], opts: { limit: number; threshold: number }): Promise<SearchResult[]> {
    const vectorStr = `[${query.join(',')}]`;
    const rows = await db.execute(sql`
      SELECT id, content, title, metadata,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM agent_memories
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorStr}::vector) >= ${opts.threshold}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${opts.limit}
    `);
    return (rows as any[]).map((row) => ({
      id: row.id,
      text: `${row.title}: ${row.content}`,
      score: row.similarity,
      metadata: row.metadata ?? {},
    }));
  }

  async delete(_id: string): Promise<void> {
    // Embedding is deleted with the memory row
  }
}
