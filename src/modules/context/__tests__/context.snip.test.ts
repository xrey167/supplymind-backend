import { describe, test, expect } from 'bun:test';
import { snipMessages } from '../context.snip';
import type { Message } from '../../../infra/ai/types';

describe('snipMessages', () => {
  test('does not snip recent messages', () => {
    const messages: Message[] = [
      { role: 'tool', content: 'a'.repeat(5000) },
    ];
    const result = snipMessages(messages, 1);
    expect((result[0].content as string).length).toBe(5000);
  });

  test('snips old tool results that exceed threshold', () => {
    const messages: Message[] = [
      { role: 'tool', content: 'x'.repeat(5000) },
    ];
    const result = snipMessages(messages, 10);
    expect((result[0].content as string).length).toBeLessThan(5000);
    expect((result[0].content as string)).toContain('[...truncated...]');
  });

  test('preserves short tool results regardless of age', () => {
    const messages: Message[] = [
      { role: 'tool', content: 'short result' },
    ];
    const result = snipMessages(messages, 100);
    expect(result[0].content).toBe('short result');
  });

  test('preserves user messages always', () => {
    const messages: Message[] = [
      { role: 'user', content: 'x'.repeat(5000) },
    ];
    const result = snipMessages(messages, 100);
    expect((result[0].content as string).length).toBe(5000);
  });
});
