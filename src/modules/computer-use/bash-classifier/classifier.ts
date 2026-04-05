import { HIGH_PATTERNS, MEDIUM_PATTERNS, type RiskPattern } from './patterns';
import { parseCommands } from './shell-parse';

export interface ClassifyResult {
  risk: 'high' | 'medium' | 'low';
  reason?: string;
  matchedPattern?: string;
}

export function classifyCommand(raw: string): ClassifyResult {
  // Layer 1: raw-string scan
  const rawHigh = matchFirst(raw, HIGH_PATTERNS);
  if (rawHigh) return { risk: 'high', reason: rawHigh.reason, matchedPattern: rawHigh.name };

  const rawMedium = matchFirst(raw, MEDIUM_PATTERNS);

  // Layer 2: tokenized scan — runs on each sub-command
  const subCommands = parseCommands(raw);
  for (const sub of subCommands) {
    const tokHigh = matchFirst(sub.raw, HIGH_PATTERNS);
    if (tokHigh) return { risk: 'high', reason: tokHigh.reason, matchedPattern: tokHigh.name };
  }

  if (rawMedium) return { risk: 'medium', reason: rawMedium.reason, matchedPattern: rawMedium.name };

  for (const sub of subCommands) {
    const tokMedium = matchFirst(sub.raw, MEDIUM_PATTERNS);
    if (tokMedium) return { risk: 'medium', reason: tokMedium.reason, matchedPattern: tokMedium.name };
  }

  return { risk: 'low' };
}

function matchFirst(text: string, patterns: RiskPattern[]): RiskPattern | undefined {
  return patterns.find(p => p.regex.test(text));
}
