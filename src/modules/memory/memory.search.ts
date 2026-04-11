import { PgVectorMemoryStore, type SearchResult } from './memory.store';
import { getEmbeddingProvider } from './memory.embedding';
import { memoryRepo as defaultMemoryRepo } from './memory.repo';

const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const DEFAULT_THRESHOLD = 0.7;

let _vectorStore: PgVectorMemoryStore | null = null;
function getVectorStore(): PgVectorMemoryStore {
  if (!_vectorStore) _vectorStore = new PgVectorMemoryStore();
  return _vectorStore;
}

export async function hybridSearch(
  query: string,
  workspaceId: string,
  agentId?: string,
  limit = 5,
  repo: Pick<typeof defaultMemoryRepo, 'search'> = defaultMemoryRepo,
): Promise<SearchResult[]> {
  const embeddingProvider = getEmbeddingProvider();

  const [vectorResults, textResults] = await Promise.all([
    (async () => {
      try {
        const embedding = await embeddingProvider.embed(query);
        return getVectorStore().search(embedding, { limit: limit * 2, threshold: DEFAULT_THRESHOLD });
      } catch {
        return [];
      }
    })(),
    (async () => {
      const memories = await repo.search(query, workspaceId, agentId, limit * 2);
      return memories.map((m) => ({
        id: m.id,
        text: `${m.title}: ${m.content}`,
        score: 1.0,
        metadata: m.metadata,
      }));
    })(),
  ]);

  const merged = new Map<string, SearchResult>();
  for (const r of vectorResults) {
    merged.set(r.id, { ...r, score: r.score * VECTOR_WEIGHT });
  }
  for (const r of textResults) {
    const existing = merged.get(r.id);
    if (existing) {
      existing.score += r.score * TEXT_WEIGHT;
    } else {
      merged.set(r.id, { ...r, score: r.score * TEXT_WEIGHT });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
