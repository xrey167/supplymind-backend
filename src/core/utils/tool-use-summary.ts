/**
 * Tool use summarization for context compression.
 *
 * Long-running agent workflows accumulate many tool calls.
 * This module compresses tool call history into compact summaries
 * so the agent's context window stays manageable.
 *
 * Strategy: keep recent N calls verbatim, summarize older ones into
 * a compact text block grouped by tool name.
 */

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: { ok: boolean; value?: unknown; error?: unknown };
  durationMs: number;
  timestamp: number;
}

export interface ToolUseSummary {
  /** Compact text summary of older tool calls. */
  summary: string;
  /** Recent tool calls kept verbatim. */
  recent: ToolCallRecord[];
  /** Total calls summarized (including recent). */
  totalCalls: number;
}

/**
 * Summarize tool call history.
 *
 * @param calls - All tool calls in chronological order
 * @param keepRecent - Number of recent calls to keep verbatim (default: 5)
 * @param maxArgLength - Max chars for arg values in summary (default: 80)
 */
export function summarizeToolUse(
  calls: ToolCallRecord[],
  keepRecent = 5,
  maxArgLength = 80,
): ToolUseSummary {
  if (calls.length <= keepRecent) {
    return { summary: '', recent: calls, totalCalls: calls.length };
  }

  const older = calls.slice(0, calls.length - keepRecent);
  const recent = calls.slice(calls.length - keepRecent);

  // Group older calls by tool name
  const groups = new Map<string, { count: number; successes: number; failures: number; totalMs: number; lastArgs: Record<string, unknown> }>();

  for (const call of older) {
    const g = groups.get(call.name) ?? { count: 0, successes: 0, failures: 0, totalMs: 0, lastArgs: {} };
    g.count++;
    if (call.result.ok) g.successes++;
    else g.failures++;
    g.totalMs += call.durationMs;
    g.lastArgs = call.args;
    groups.set(call.name, g);
  }

  const lines: string[] = [`${older.length} earlier tool calls:`];
  for (const [name, g] of groups) {
    const argsPreview = truncate(JSON.stringify(g.lastArgs), maxArgLength);
    const status = g.failures > 0 ? `${g.successes}ok/${g.failures}err` : `${g.successes}ok`;
    lines.push(`  ${name} ×${g.count} (${status}, ${g.totalMs}ms total) last args: ${argsPreview}`);
  }

  return {
    summary: lines.join('\n'),
    recent,
    totalCalls: calls.length,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}
