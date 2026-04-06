import type { TranscriptEntry } from '../sessions/transcript-chain';

export interface ExtractedFact {
  key: string;
  value: unknown;
  scope: 'user' | 'workspace';
  confidence: number; // 0-1
}

// Heuristic patterns for extracting facts from user messages
const PATTERNS: Array<{
  key: string;
  regex: RegExp;
  extract: (match: RegExpMatchArray) => unknown;
  scope: 'user' | 'workspace';
}> = [
  {
    key: 'user_name',
    regex: /\bmy name is\s+(\w+)/i,
    extract: m => m[1],
    scope: 'user',
  },
  {
    key: 'language_preference',
    regex: /\b(?:respond|reply|answer|write)\s+in\s+(\w+)/i,
    extract: m => m[1],
    scope: 'user',
  },
  {
    key: 'timezone',
    regex: /\b(?:i(?:'m| am) in(?: the)?\s+)?(UTC[+-]\d+|[A-Z]{2,4}T)\b/,
    extract: m => m[1] ?? m[0],
    scope: 'user',
  },
  {
    key: 'ui_preference',
    regex: /\b(?:prefer|use|want)\s+(dark|light)\s+mode/i,
    extract: m => `${m[1]}_mode`,
    scope: 'user',
  },
];

/**
 * Heuristic extraction: scan transcript entries for extractable user facts.
 * Only processes user-role messages (not assistant responses).
 */
export function extractFacts(entries: Pick<TranscriptEntry, 'role' | 'content'>[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    for (const pattern of PATTERNS) {
      const match = entry.content.match(pattern.regex);
      if (match) {
        facts.push({
          key: pattern.key,
          value: pattern.extract(match),
          scope: pattern.scope,
          confidence: 0.8,
        });
      }
    }
  }
  return facts;
}

/**
 * Detect conflicts: returns true if newValue contradicts the stored value
 * for the same key (both non-null and different).
 */
export function detectConflict(storedValue: unknown, newValue: unknown): boolean {
  if (storedValue === undefined || storedValue === null) return false;
  if (newValue === undefined || newValue === null) return false;
  return String(storedValue).toLowerCase() !== String(newValue).toLowerCase();
}
