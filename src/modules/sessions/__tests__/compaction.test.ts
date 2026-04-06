import { describe, it, expect } from 'bun:test';
import { resolveSummarizerModel } from '../compaction.service';

describe('resolveSummarizerModel', () => {
  it('opus → sonnet', () => {
    expect(resolveSummarizerModel('claude-opus-4-6')).toBe('claude-sonnet-4-6');
  });

  it('sonnet → haiku', () => {
    expect(resolveSummarizerModel('claude-sonnet-4-6')).toBe('claude-haiku-4-5-20251001');
  });

  it('haiku → haiku (floor)', () => {
    expect(resolveSummarizerModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });

  it('unknown model → haiku (default)', () => {
    expect(resolveSummarizerModel('gpt-4o')).toBe('claude-haiku-4-5-20251001');
    expect(resolveSummarizerModel('gemini-1.5-pro')).toBe('claude-haiku-4-5-20251001');
    expect(resolveSummarizerModel('')).toBe('claude-haiku-4-5-20251001');
  });
});
