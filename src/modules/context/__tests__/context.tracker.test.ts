import { describe, test, expect } from 'bun:test';
import { estimateTokens, estimateMessageTokens, totalMessageTokens, getBudget, messageBudget } from '../context.tracker';

describe('context.tracker', () => {
  test('estimateTokens returns reasonable estimate for English text', () => {
    const tokens = estimateTokens('Hello, world! This is a test.');
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  test('estimateTokens returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('estimateMessageTokens handles string content', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'Hello world' });
    expect(tokens).toBeGreaterThan(4);
  });

  test('totalMessageTokens sums all messages', () => {
    const total = totalMessageTokens([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there, how can I help?' },
    ]);
    expect(total).toBeGreaterThan(10);
  });

  test('getBudget returns known model limits', () => {
    const budget = getBudget('claude-sonnet-4-20250514');
    expect(budget.totalLimit).toBe(200_000);
  });

  test('getBudget returns defaults for unknown model', () => {
    const budget = getBudget('unknown-model');
    expect(budget.totalLimit).toBe(200_000);
  });

  test('messageBudget calculates available token space', () => {
    const budget = getBudget('claude-sonnet-4-20250514');
    const available = messageBudget(budget);
    expect(available).toBeGreaterThan(100_000);
    expect(available).toBeLessThan(150_000);
  });
});
