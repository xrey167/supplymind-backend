import { describe, it, expect } from 'bun:test';
import { extractFacts, type ExtractedFact } from '../auto-extract';

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
});
