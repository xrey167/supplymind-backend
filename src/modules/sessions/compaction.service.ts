import { db } from '../../infra/db/client';
import { sessionMessages } from '../../infra/db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { AnthropicRawRuntime } from '../../infra/ai/anthropic';
import { eventBus } from '../../events/bus';
import { Topics } from '../../events/topics';
import { logger } from '../../config/logger';
import { COMPACTION_SYSTEM_PROMPT } from './compaction.prompts';
import type { SessionMessage } from './sessions.types';
import type { AgentRuntime } from '../../infra/ai/types';

const SUMMARIZER_FLOOR = 'claude-haiku-4-5-20251001';

const MODEL_TIER_DOWN: Record<string, string> = {
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': SUMMARIZER_FLOOR,
  'claude-haiku-4-5-20251001': SUMMARIZER_FLOOR,
};

export function resolveSummarizerModel(sessionModel: string): string {
  return MODEL_TIER_DOWN[sessionModel] ?? SUMMARIZER_FLOOR;
}

export const COMPACTION_THRESHOLD_TOKENS = 120_000;
const KEEP_LAST_N = 6;

export async function compactSession(
  sessionId: string,
  workspaceId: string,
  activeMessages: SessionMessage[],
  sessionModel: string,
  runtime?: AgentRuntime,
): Promise<void> {
  const toSummarize = activeMessages.slice(0, -KEEP_LAST_N);
  if (toSummarize.length === 0) return;

  const summarizerModel = resolveSummarizerModel(sessionModel);
  const rt = runtime ?? new AnthropicRawRuntime();

  const aiMessages = toSummarize.map((m) => ({
    role: (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system',
    content: m.role === 'tool'
      ? `[Tool result for ${m.toolCallId ?? 'unknown'}]: ${m.content}`
      : m.content,
  }));

  const result = await rt.run({
    model: summarizerModel,
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    messages: aiMessages,
    maxTokens: 2048,
    temperature: 0,
  });

  if (!result.ok) {
    logger.error({ sessionId, err: result.error }, 'compactSession: summarizer failed — skipping');
    return;
  }

  const summaryText = result.value.content;
  const summaryTokens = Math.ceil(summaryText.length / 3.2);
  const boundary = toSummarize[toSummarize.length - 1];
  const activeTokensBefore = activeMessages.reduce((s, m) => s + (m.tokenEstimate ?? 0), 0);
  const activeTokensAfter = activeMessages.slice(-KEEP_LAST_N).reduce((s, m) => s + (m.tokenEstimate ?? 0), 0) + summaryTokens;

  await db.transaction(async (tx) => {
    await tx.update(sessionMessages)
      .set({ isCompacted: true })
      .where(and(
        eq(sessionMessages.sessionId, sessionId),
        lte(sessionMessages.createdAt, boundary.createdAt),
        eq(sessionMessages.isCompacted, false),
      ));

    await tx.insert(sessionMessages).values({
      sessionId,
      role: 'system' as any,
      content: summaryText,
      isCompacted: true,
      tokenEstimate: summaryTokens,
    });
  });

  eventBus.publish(Topics.SESSION_COMPACTED, {
    sessionId,
    workspaceId,
    messagesCompacted: toSummarize.length,
    summaryTokens,
    activeTokensBefore,
    activeTokensAfter,
  }).catch((err: unknown) => logger.error({ sessionId, err }, 'Failed to publish SESSION_COMPACTED'));
}
