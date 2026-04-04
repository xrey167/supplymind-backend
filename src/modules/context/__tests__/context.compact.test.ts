import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { Message } from '../../../infra/ai/types';

// --- Mock helpers ---

let mockRunResult: { ok: boolean; value?: { content: string }; error?: unknown } = {
  ok: true,
  value: { content: 'Summary of the conversation.' },
};

let mockRunCalled = false;
let mockRunInput: unknown = null;
let mockRunShouldThrow = false;

mock.module('../../../infra/ai/runtime-factory', () => ({
  createRuntime: (_provider: string, _mode: string) => ({
    run: async (input: unknown) => {
      mockRunCalled = true;
      mockRunInput = input;
      if (mockRunShouldThrow) throw new Error('Network error');
      return mockRunResult;
    },
    stream: async function* () {},
  }),
}));

// Import after mock registration
const { compactMessages } = await import('../context.compact');

function makeMessages(n: number, role: 'user' | 'assistant' = 'user'): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    role,
    content: `Message ${i + 1}`,
  }));
}

beforeEach(() => {
  mockRunCalled = false;
  mockRunInput = null;
  mockRunShouldThrow = false;
  mockRunResult = { ok: true, value: { content: 'Summary of the conversation.' } };
});

// ---------------------------------------------------------------------------

describe('compactMessages', () => {
  describe('when messages are at or below keepLastN threshold', () => {
    test('should return original messages and empty summary when message count equals keepLastN', async () => {
      const messages = makeMessages(3);
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages).toEqual(messages);
      expect(result.summary).toEqual({ role: 'system', content: '' });
    });

    test('should return original messages and empty summary when message count is below keepLastN', async () => {
      const messages = makeMessages(2);
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages).toEqual(messages);
      expect(result.summary).toEqual({ role: 'system', content: '' });
    });

    test('should not call the AI runtime when no compaction is needed', async () => {
      const messages = makeMessages(3);
      await compactMessages(messages, 3);

      expect(mockRunCalled).toBe(false);
    });
  });

  describe('empty and single message edge cases', () => {
    test('should handle empty messages array without calling the AI runtime', async () => {
      const result = await compactMessages([], 3);

      expect(result.keptMessages).toEqual([]);
      expect(result.summary).toEqual({ role: 'system', content: '' });
      expect(mockRunCalled).toBe(false);
    });

    test('should handle single message without calling the AI runtime', async () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages).toEqual(messages);
      expect(result.summary).toEqual({ role: 'system', content: '' });
      expect(mockRunCalled).toBe(false);
    });
  });

  describe('basic compaction behavior', () => {
    test('should call the AI runtime when messages exceed keepLastN', async () => {
      const messages = makeMessages(5);
      await compactMessages(messages, 3);

      expect(mockRunCalled).toBe(true);
    });

    test('should keep exactly the last N messages', async () => {
      const messages = makeMessages(6);
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages).toHaveLength(3);
      expect(result.keptMessages).toEqual(messages.slice(-3));
    });

    test('should compact all messages before the last N', async () => {
      const messages = makeMessages(6);
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages[0]).toEqual(messages[3]);
      expect(result.keptMessages[1]).toEqual(messages[4]);
      expect(result.keptMessages[2]).toEqual(messages[5]);
    });

    test('should return summary with system role and prefixed content on success', async () => {
      const messages = makeMessages(5);
      const result = await compactMessages(messages, 3);

      expect(result.summary.role).toBe('system');
      expect(typeof result.summary.content).toBe('string');
      expect((result.summary.content as string)).toContain('[Conversation summary]:');
      expect((result.summary.content as string)).toContain('Summary of the conversation.');
    });

    test('should use default keepLastN of 3 when not specified', async () => {
      const messages = makeMessages(6);
      const result = await compactMessages(messages);

      expect(result.keptMessages).toHaveLength(3);
      expect(result.keptMessages).toEqual(messages.slice(-3));
    });
  });

  describe('content formatting sent to AI', () => {
    test('should format messages with role prefix in the content sent to AI', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'What is the inventory count?' },
        { role: 'assistant', content: 'The inventory count is 150 units.' },
        { role: 'user', content: 'Recent message' },
      ];

      await compactMessages(messages, 1);

      const input = mockRunInput as { messages: Message[] };
      const sentContent = input.messages[0].content as string;
      expect(sentContent).toContain('[user]: What is the inventory count?');
      expect(sentContent).toContain('[assistant]: The inventory count is 150 units.');
    });

    test('should JSON-stringify non-string content blocks before sending to AI', async () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Tool result data' }],
        },
        { role: 'user', content: 'Recent message' },
      ];

      await compactMessages(messages, 1);

      const input = mockRunInput as { messages: Message[] };
      const sentContent = input.messages[0].content as string;
      expect(sentContent).toContain('[assistant]:');
      expect(sentContent).toContain('Tool result data');
    });
  });

  describe('recent messages are kept preferentially', () => {
    test('should always keep the most recent message', async () => {
      const messages = makeMessages(10);
      const lastMessage = messages[9];
      const result = await compactMessages(messages, 3);

      expect(result.keptMessages).toContainEqual(lastMessage);
    });

    test('should keep the last N messages in original order', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
      ];

      const result = await compactMessages(messages, 2);

      expect(result.keptMessages).toEqual([
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
      ]);
    });

    test('should compact older messages when many messages are present', async () => {
      const messages = makeMessages(20);
      const result = await compactMessages(messages, 5);

      expect(result.keptMessages).toHaveLength(5);
      expect(result.keptMessages).toEqual(messages.slice(-5));
      expect(mockRunCalled).toBe(true);
    });
  });

  describe('system prompt preservation', () => {
    test('should return summary as a system message', async () => {
      const messages = makeMessages(5);
      const result = await compactMessages(messages, 2);

      expect(result.summary.role).toBe('system');
    });

    test('should return empty system content when no compaction was needed', async () => {
      const messages = makeMessages(2);
      const result = await compactMessages(messages, 3);

      expect(result.summary).toEqual({ role: 'system', content: '' });
    });
  });

  describe('graceful degradation on failure', () => {
    test('should return original messages when AI runtime throws', async () => {
      mockRunShouldThrow = true;
      const messages = makeMessages(5);
      const result = await compactMessages(messages, 2);

      expect(result.keptMessages).toEqual(messages);
      expect(result.summary).toEqual({ role: 'system', content: '' });
    });

    test('should return original messages when AI runtime returns an error result', async () => {
      mockRunResult = { ok: false, error: new Error('AI error') };
      const messages = makeMessages(5);
      const result = await compactMessages(messages, 2);

      expect(result.keptMessages).toEqual(messages);
      expect(result.summary).toEqual({ role: 'system', content: '' });
    });

    test('should not throw when AI runtime fails', async () => {
      mockRunShouldThrow = true;
      const messages = makeMessages(10);

      await expect(compactMessages(messages, 3)).resolves.toBeDefined();
    });
  });

  describe('token counting integration', () => {
    test('should compact messages regardless of their token count', async () => {
      const longMessages: Message[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `${'a'.repeat(500)} message ${i}`,
      }));

      const result = await compactMessages(longMessages, 2);

      expect(result.keptMessages).toHaveLength(2);
      expect(mockRunCalled).toBe(true);
    });

    test('should include all older messages in the compaction payload', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
        { role: 'user', content: 'kept1' },
        { role: 'user', content: 'kept2' },
      ];

      await compactMessages(messages, 2);

      const input = mockRunInput as { messages: Message[] };
      const sentContent = input.messages[0].content as string;
      expect(sentContent).toContain('first');
      expect(sentContent).toContain('second');
      expect(sentContent).toContain('third');
      // Kept messages should NOT be in the compacted content
      expect(sentContent).not.toContain('kept1');
      expect(sentContent).not.toContain('kept2');
    });
  });
});
