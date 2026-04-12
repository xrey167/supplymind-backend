import { IntentTier } from '../../core/ai/types';
import type { DomainKeywords } from '../../modules/domain-knowledge/domain-knowledge.service';

export { IntentTier };

// Per-workspace domain keyword cache (invalidated on DOMAIN_KNOWLEDGE_UPDATED)
const domainKeywordCache = new Map<string, { keywords: DomainKeywords; expiresAt: number }>();
const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateDomainRouterCache(workspaceId: string): void {
  domainKeywordCache.delete(workspaceId);
}

const DEFAULT_MODELS: Record<IntentTier, string> = {
  [IntentTier.FAST]:     'claude-haiku-4-5-20251001',
  [IntentTier.BALANCED]: 'claude-sonnet-4-6',
  [IntentTier.POWERFUL]: 'claude-opus-4-6',
};

const TIER_KEYWORDS: Record<IntentTier, string[]> = {
  [IntentTier.FAST]: [
    'hello', 'hi', 'hey', 'yes', 'no', 'ok', 'thanks', 'list', 'show', 'get', 'what is',
  ],
  [IntentTier.BALANCED]: [
    'explain', 'analyze', 'describe', 'summarize', 'review', 'check', 'find', 'debug',
    'fix', 'help', 'suggest', 'compare', 'translate',
  ],
  [IntentTier.POWERFUL]: [
    'design', 'architect', 'implement', 'build', 'create', 'refactor', 'migrate',
    'optimize', 'integrate', 'generate', 'plan', 'complete', 'full',
    'distributed', 'microservices', 'infrastructure',
  ],
};

/**
 * Classify a prompt into an intent tier using keyword scoring.
 * Counts ALL keyword matches per tier, picks the highest score.
 * Short prompts (< 5 words) with no strong signal default to FAST.
 */
export function classifyIntent(prompt: string): IntentTier {
  const lower = prompt.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  const scores: Record<IntentTier, number> = {
    [IntentTier.FAST]: 0,
    [IntentTier.BALANCED]: 0,
    [IntentTier.POWERFUL]: 0,
  };

  for (const [tier, keywords] of Object.entries(TIER_KEYWORDS) as [IntentTier, string[]][]) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[tier]++;
    }
  }

  // Short prompts with no strong signal default to FAST
  if (wordCount < 5 && scores[IntentTier.POWERFUL] === 0 && scores[IntentTier.BALANCED] === 0) {
    return IntentTier.FAST;
  }

  // Pick highest score; POWERFUL wins ties over BALANCED
  if (scores[IntentTier.POWERFUL] > 0 && scores[IntentTier.POWERFUL] >= scores[IntentTier.BALANCED]) {
    return IntentTier.POWERFUL;
  }
  if (scores[IntentTier.BALANCED] > 0) {
    return IntentTier.BALANCED;
  }
  if (scores[IntentTier.FAST] > 0) {
    return IntentTier.FAST;
  }

  return wordCount < 20 ? IntentTier.FAST : IntentTier.BALANCED;
}

/**
 * Domain-aware intent classification.
 *
 * Merges domain primaryActions into the BALANCED tier keyword set and
 * domain riskTerms into the POWERFUL tier keyword set before scoring.
 * This makes the router automatically aware of plugin-specific vocabulary.
 *
 * @param prompt          The user prompt to classify.
 * @param domainKeywords  Domain keywords from the active workspace's knowledge graphs.
 */
export function classifyIntentWithDomain(prompt: string, domainKeywords: DomainKeywords): IntentTier {
  const lower = prompt.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  const effectiveKeywords: Record<IntentTier, string[]> = {
    [IntentTier.FAST]: [...TIER_KEYWORDS[IntentTier.FAST]],
    [IntentTier.BALANCED]: [...TIER_KEYWORDS[IntentTier.BALANCED], ...domainKeywords.primaryActions],
    [IntentTier.POWERFUL]: [...TIER_KEYWORDS[IntentTier.POWERFUL], ...domainKeywords.riskTerms],
  };

  const scores: Record<IntentTier, number> = {
    [IntentTier.FAST]: 0,
    [IntentTier.BALANCED]: 0,
    [IntentTier.POWERFUL]: 0,
  };

  for (const [tier, keywords] of Object.entries(effectiveKeywords) as [IntentTier, string[]][]) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[tier]++;
    }
  }

  if (wordCount < 5 && scores[IntentTier.POWERFUL] === 0 && scores[IntentTier.BALANCED] === 0) {
    return IntentTier.FAST;
  }
  if (scores[IntentTier.POWERFUL] > 0 && scores[IntentTier.POWERFUL] >= scores[IntentTier.BALANCED]) {
    return IntentTier.POWERFUL;
  }
  if (scores[IntentTier.BALANCED] > 0) return IntentTier.BALANCED;
  if (scores[IntentTier.FAST] > 0) return IntentTier.FAST;
  return wordCount < 20 ? IntentTier.FAST : IntentTier.BALANCED;
}

/**
 * Route a tier to a concrete model ID.
 * Checks env overrides first, falls back to DEFAULT_MODELS.
 */
export function routeModel(
  tier: IntentTier,
  overrides: Record<string, string | undefined>,
): string {
  const overrideKey: Record<IntentTier, string> = {
    [IntentTier.FAST]:     'MODEL_OVERRIDE_FAST',
    [IntentTier.BALANCED]: 'MODEL_OVERRIDE_BALANCED',
    [IntentTier.POWERFUL]: 'MODEL_OVERRIDE_POWERFUL',
  };
  return overrides[overrideKey[tier]] ?? DEFAULT_MODELS[tier];
}
