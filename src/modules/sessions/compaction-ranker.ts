import type { TranscriptEntry } from './transcript-chain';

export interface RankableEntry {
  id: string;
  role: TranscriptEntry['role'];
  content: string;
  toolCallId?: string;
  toolResultId?: string;
}

export interface CompactionOptions {
  /** Maximum number of entries to keep after compaction. */
  maxEntries: number;
}

/**
 * Score an entry by information density:
 * - Base score from content length (capped)
 * - Bonus for code blocks, bullet lists, headings
 */
function densityScore(entry: RankableEntry): number {
  const len = Math.min(entry.content.length, 2000);
  const codeBlocks = (entry.content.match(/```/g) ?? []).length / 2;
  const bulletPoints = (entry.content.match(/^\s*[-*•]/gm) ?? []).length;
  const headings = (entry.content.match(/^#{1,3}\s/gm) ?? []).length;
  return len + codeBlocks * 200 + bulletPoints * 50 + headings * 100;
}

/**
 * Rank entries by information density.
 * Returns a Map<entryId, score>.
 */
export function rankByDensity(entries: RankableEntry[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const entry of entries) {
    scores.set(entry.id, densityScore(entry));
  }
  return scores;
}

/**
 * Select entries to keep after compaction.
 *
 * Rules:
 * - Always preserves the most recent tool call AND its paired result (by toolCallId/toolResultId).
 * - Fills remaining slots with highest-density entries.
 * - Preserves original order in the returned array.
 */
export function selectForCompaction(
  entries: RankableEntry[],
  opts: CompactionOptions,
): RankableEntry[] {
  if (entries.length <= opts.maxEntries) return [...entries];

  // Find the most recent tool call/result pair to protect
  const protectedIds = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.toolCallId !== undefined) {
      protectedIds.add(entry.id);
      // Find the matching result
      for (const e of entries) {
        if (e.toolResultId === entry.toolCallId) {
          protectedIds.add(e.id);
        }
      }
      break;
    }
  }

  const scores = rankByDensity(entries);
  const remaining = opts.maxEntries - protectedIds.size;

  // Sort non-protected entries by density descending
  const candidates = entries
    .filter(e => !protectedIds.has(e.id))
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    .slice(0, Math.max(remaining, 0))
    .map(e => e.id);

  const keepIds = new Set([...protectedIds, ...candidates]);

  // Return in original order
  return entries.filter(e => keepIds.has(e.id));
}
