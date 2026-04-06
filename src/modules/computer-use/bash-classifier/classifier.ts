import { HIGH_PATTERNS, MEDIUM_PATTERNS, type RiskPattern } from './patterns';

export interface ClassifyResult {
  risk: 'high' | 'medium' | 'low';
  reason?: string;
  matchedPattern?: string;
}

export function classifyCommand(raw: string): ClassifyResult {
  const high = matchFirst(raw, HIGH_PATTERNS);
  if (high) return { risk: 'high', reason: high.reason, matchedPattern: high.name };

  const medium = matchFirst(raw, MEDIUM_PATTERNS);
  if (medium) return { risk: 'medium', reason: medium.reason, matchedPattern: medium.name };

  return { risk: 'low' };
}

function matchFirst(text: string, patterns: RiskPattern[]): RiskPattern | undefined {
  return patterns.find(p => p.regex.test(text));
}
