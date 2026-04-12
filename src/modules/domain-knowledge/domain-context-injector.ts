/**
 * Domain Context Injector
 *
 * At inference time, fetches relevant domain context (entities, rules, vocabulary)
 * from the knowledge graph and returns a formatted string to prepend to the
 * system prompt. Caches per (workspaceId, contentHash) with 5-minute TTL.
 */

import { domainKnowledgeService } from './domain-knowledge.service';
import { logger } from '../../config/logger';
import type { DomainEntity, DomainRule, VocabularyTerm } from '../plugins/plugin-manifest';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CONTEXT_TOKEN_BUDGET = 500; // ~500 tokens of domain context

interface CacheEntry {
  context: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function simpleSimilarity(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase())).length;
}

/**
 * Build a concise domain context string for injection into a system prompt.
 * Selects the most relevant entities and vocabulary based on the prompt text.
 *
 * @param workspaceId  The workspace to fetch domain knowledge for.
 * @param promptText   The user prompt (used for relevance ranking).
 * @param tokenBudget  Approximate token limit for the context block.
 */
export async function buildDomainContext(
  workspaceId: string,
  promptText: string,
  tokenBudget?: number,
): Promise<string> {
  if (tokenBudget === undefined) {
    try {
      const { workspaceSettingsService } = await import('../settings/workspace-settings/workspace-settings.service');
      const { WorkspaceSettingKeys: K } = await import('../settings/workspace-settings/workspace-settings.schemas');
      const raw = await workspaceSettingsService.getRaw(workspaceId, K.LEARNING_DOMAIN_CONTEXT_BUDGET);
      tokenBudget = typeof raw === 'number' ? raw : DEFAULT_CONTEXT_TOKEN_BUDGET;
    } catch {
      tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET;
    }
  }

  const cacheKey = `${workspaceId}:${simpleHash(promptText)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.context;
  }

  try {
    const graphs = await domainKnowledgeService.listForWorkspace(workspaceId);
    if (graphs.length === 0) return '';

    const sections: string[] = [];
    let remainingBudget = tokenBudget;

    for (const graph of graphs) {
      if (remainingBudget <= 0) break;

      const graphSections: string[] = [];

      // Score and select top entities by relevance to prompt
      const scoredEntities = graph.entityGraph
        .map((e: DomainEntity) => ({
          entity: e,
          score: simpleSimilarity(promptText, [e.name, ...(e.aliases ?? [])]),
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (scoredEntities.length > 0) {
        const entityLines = scoredEntities.map(({ entity }) => {
          const aliases = entity.aliases?.length ? ` (also: ${entity.aliases.join(', ')})` : '';
          return `  - ${entity.name}${aliases}: ${entity.description}`;
        });
        graphSections.push(`Domain Entities:\n${entityLines.join('\n')}`);
        remainingBudget -= entityLines.join('\n').length / 4; // rough token estimate
      }

      // Include applicable rules (severity >= warn)
      const applicableRules = graph.rules
        .filter((r: DomainRule) => r.severity !== 'info')
        .slice(0, 3);
      if (applicableRules.length > 0) {
        const ruleLines = applicableRules.map((r: DomainRule) => `  [${r.severity.toUpperCase()}] ${r.description}`);
        graphSections.push(`Business Rules:\n${ruleLines.join('\n')}`);
        remainingBudget -= ruleLines.join('\n').length / 4;
      }

      // Top vocabulary terms relevant to prompt
      const scoredVocab = graph.vocabulary
        .map((v: VocabularyTerm) => ({ term: v, score: simpleSimilarity(promptText, [v.term]) }))
        .filter((s) => s.score > 0)
        .slice(0, 5);
      if (scoredVocab.length > 0) {
        const vocabLines = scoredVocab.map(({ term }) => `  - ${term.term}: ${term.definition}`);
        graphSections.push(`Domain Vocabulary:\n${vocabLines.join('\n')}`);
      }

      if (graphSections.length > 0) {
        sections.push(`[${graph.pluginId} domain context]\n${graphSections.join('\n\n')}`);
      }
    }

    const context = sections.length > 0
      ? `--- Domain Knowledge ---\n${sections.join('\n\n')}\n--- End Domain Knowledge ---`
      : '';

    cache.set(cacheKey, { context, expiresAt: Date.now() + CACHE_TTL_MS });
    return context;
  } catch (error) {
    logger.warn({ workspaceId, error }, 'Domain context injection failed — proceeding without domain context');
    return '';
  }
}

/** Invalidate all cache entries for a workspace (called on DOMAIN_KNOWLEDGE_UPDATED). */
export function invalidateDomainContextCache(workspaceId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      cache.delete(key);
    }
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 200); i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
