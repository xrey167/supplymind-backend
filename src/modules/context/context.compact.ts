import type { Message } from '../../infra/ai/types';
import { createRuntime } from '../../infra/ai/runtime-factory';
import { estimateMessageTokens } from './context.tracker';

const COMPACT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_SUMMARY_TOKENS = 500;

const COMPACT_PROMPT = `Summarize the following conversation, preserving:
- All key facts and entity references (names, numbers, dates)
- All decisions made and their reasoning
- All pending actions or open questions
- Tool call results that produced important data

Be concise. Max 500 tokens. Output only the summary, no preamble.`;

export async function compactMessages(
  messages: Message[],
  keepLastN = 3,
): Promise<{ summary: Message; keptMessages: Message[] }> {
  if (messages.length <= keepLastN) {
    return { summary: { role: 'system', content: '' }, keptMessages: messages };
  }

  const toCompact = messages.slice(0, -keepLastN);
  const kept = messages.slice(-keepLastN);

  const conversationText = toCompact
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role}]: ${content}`;
    })
    .join('\n\n');

  try {
    const runtime = createRuntime('anthropic', 'raw');
    const result = await runtime.run({
      messages: [{ role: 'user', content: conversationText }],
      systemPrompt: COMPACT_PROMPT,
      model: COMPACT_MODEL,
      maxTokens: MAX_SUMMARY_TOKENS,
      temperature: 0,
    });

    if (result.ok) {
      return {
        summary: { role: 'system', content: `[Conversation summary]: ${result.value.content}` },
        keptMessages: kept,
      };
    }
  } catch {
    // Compaction failed — return original messages (graceful degradation)
  }

  return { summary: { role: 'system', content: '' }, keptMessages: messages };
}
