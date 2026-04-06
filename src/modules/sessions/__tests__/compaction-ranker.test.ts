import { describe, it, expect } from 'bun:test';
import { rankByDensity, selectForCompaction } from '../compaction-ranker';
import type { RankableEntry } from '../compaction-ranker';

function entry(id: string, content: string, opts?: Partial<RankableEntry>): RankableEntry {
  return { id, role: 'user', content, ...opts };
}

describe('rankByDensity', () => {
  it('scores longer content higher', () => {
    const entries = [
      entry('a', 'short'),
      entry('b', 'a'.repeat(500)),
    ];
    const scores = rankByDensity(entries);
    expect(scores.get('b')!).toBeGreaterThan(scores.get('a')!);
  });

  it('gives bonus for code blocks', () => {
    const plain = entry('plain', 'a'.repeat(100));
    const withCode = entry('code', `${'a'.repeat(100)}\n\`\`\`ts\nconst x = 1;\n\`\`\``);
    const scores = rankByDensity([plain, withCode]);
    expect(scores.get('code')!).toBeGreaterThan(scores.get('plain')!);
  });

  it('gives bonus for bullet points', () => {
    const plain = entry('plain', 'line1\nline2\nline3');
    const bullets = entry('bullets', '- line1\n- line2\n- line3');
    const scores = rankByDensity([plain, bullets]);
    expect(scores.get('bullets')!).toBeGreaterThan(scores.get('plain')!);
  });
});

describe('selectForCompaction', () => {
  it('returns all entries when under maxEntries', () => {
    const entries = [entry('a', 'x'), entry('b', 'y')];
    const result = selectForCompaction(entries, { maxEntries: 5 });
    expect(result).toHaveLength(2);
  });

  it('preserves the most recent tool call/result pair', () => {
    const entries: RankableEntry[] = [
      entry('e1', 'low', { role: 'user' }),
      entry('e2', 'low2', { role: 'user' }),
      entry('e3', 'tool call', { role: 'assistant', toolCallId: 'tc1' }),
      entry('e4', 'tool result', { role: 'tool', toolResultId: 'tc1' }),
    ];
    // maxEntries=2 — only 2 slots, but tool pair must be protected
    const result = selectForCompaction(entries, { maxEntries: 2 });
    const ids = result.map(e => e.id);
    expect(ids).toContain('e3');
    expect(ids).toContain('e4');
  });

  it('selects highest density non-protected entries to fill remaining slots', () => {
    const entries: RankableEntry[] = [
      entry('low', 'x'),
      entry('high', 'a'.repeat(800)),
      entry('tool', 'call', { toolCallId: 'tc1' }),
      entry('result', 'res', { toolResultId: 'tc1' }),
    ];
    const result = selectForCompaction(entries, { maxEntries: 3 });
    const ids = result.map(e => e.id);
    expect(ids).toContain('tool');
    expect(ids).toContain('result');
    expect(ids).toContain('high');
    expect(ids).not.toContain('low');
  });

  it('preserves original order in result', () => {
    const entries: RankableEntry[] = [
      entry('a', 'a'.repeat(500)),
      entry('b', 'b'.repeat(500)),
      entry('c', 'c'.repeat(500)),
    ];
    const result = selectForCompaction(entries, { maxEntries: 2 });
    // order of result should follow original order
    const ids = result.map(e => e.id);
    for (let i = 0; i < ids.length - 1; i++) {
      const origA = entries.findIndex(e => e.id === ids[i]);
      const origB = entries.findIndex(e => e.id === ids[i + 1]);
      expect(origA).toBeLessThan(origB);
    }
  });
});
