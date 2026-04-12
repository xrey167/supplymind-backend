import { describe, it, expect } from 'bun:test';
import { extractFacts, detectConflict, type ExtractedFact } from '../auto-extract';

const entry = (role: 'user' | 'assistant', content: string) => ({
  id: 'e1',
  role,
  content,
  createdAt: new Date(),
});

describe('extractFacts', () => {
  it('extracts name preferences', () => {
    const facts = extractFacts([
      entry('user', 'My name is Alice and I prefer to be called Al'),
    ]);
    expect(facts.some(f => f.key.includes('name') || String(f.value).toLowerCase().includes('alice'))).toBe(true);
  });

  it('extracts language preferences', () => {
    const facts = extractFacts([
      entry('user', 'Please always respond in German'),
    ]);
    expect(facts.some(f => f.key === 'language_preference' || String(f.value).includes('German'))).toBe(true);
  });

  it('extracts timezone mentions', () => {
    const facts = extractFacts([
      entry('user', 'I am in the UTC+2 timezone'),
    ]);
    expect(facts.some(f => f.key === 'timezone')).toBe(true);
  });

  it('returns empty array for content with no extractable facts', () => {
    const facts = extractFacts([
      entry('user', 'What is the weather like?'),
    ]);
    expect(facts.length).toBe(0);
  });

  it('extracts facts from multiple entries', () => {
    const facts = extractFacts([
      entry('user', 'My name is Bob'),
      entry('user', 'I prefer dark mode'),
    ]);
    expect(facts.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores assistant-role messages', () => {
    const facts = extractFacts([
      entry('assistant', 'My name is Bot'),
    ]);
    expect(facts.length).toBe(0);
  });

  it('extracts UI preference (dark mode)', () => {
    const facts = extractFacts([entry('user', 'I prefer dark mode')]);
    expect(facts.some(f => f.key === 'ui_preference' && f.value === 'dark_mode')).toBe(true);
  });
});

describe('detectConflict', () => {
  it('returns false when stored value is null', () => {
    expect(detectConflict(null, 'new')).toBe(false);
  });

  it('returns false when stored value is undefined', () => {
    expect(detectConflict(undefined, 'new')).toBe(false);
  });

  it('returns false when new value is null', () => {
    expect(detectConflict('old', null)).toBe(false);
  });

  it('returns false when new value is undefined', () => {
    expect(detectConflict('old', undefined)).toBe(false);
  });

  it('returns false when values match (same case)', () => {
    expect(detectConflict('Alice', 'Alice')).toBe(false);
  });

  it('returns false when values match (case-insensitive)', () => {
    expect(detectConflict('alice', 'ALICE')).toBe(false);
  });

  it('returns true when values differ', () => {
    expect(detectConflict('Alice', 'Bob')).toBe(true);
  });

  it('handles numeric values via string coercion', () => {
    expect(detectConflict(42, 42)).toBe(false);
    expect(detectConflict(42, 99)).toBe(true);
  });

  it('returns false when both values are null', () => {
    expect(detectConflict(null, null)).toBe(false);
  });
});
