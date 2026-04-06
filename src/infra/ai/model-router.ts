import { IntentTier } from '../../core/ai/types';

export { IntentTier };

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
