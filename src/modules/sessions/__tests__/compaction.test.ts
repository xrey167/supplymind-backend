import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { resolveSummarizerModel, compactSession, COMPACTION_THRESHOLD_TOKENS } from '../compaction.service';
import type { SessionMessage } from '../sessions.types';
import type { AgentRuntime } from '../../../infra/ai/types';
import { logger } from '../../../config/logger';

// Silence logger during tests that exercise error paths
const silentLogger = { error: mock(() => {}), warn: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) };
let originalError: typeof logger.error;
beforeEach(() => { originalError = logger.error; (logger as any).error = silentLogger.error; });
afterEach(() => { (logger as any).error = originalError; silentLogger.error.mockClear(); });

function makeMsg(id: string, role: 'user' | 'assistant', content: string, sessionId = 'sess-1'): SessionMessage {
  return {
    id,
    sessionId,
    role,
    content,
    isCompacted: false,
    createdAt: new Date(Date.now() + Number(id) * 1000),
    tokenEstimate: Math.ceil(content.length / 3.2),
  };
}

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

describe('compactSession', () => {
  it('exports COMPACTION_THRESHOLD_TOKENS as 120000', () => {
    expect(COMPACTION_THRESHOLD_TOKENS).toBe(120_000);
  });

  it('does nothing when fewer messages than KEEP_LAST_N (6)', async () => {
    const msgs = [makeMsg('1', 'user', 'hi'), makeMsg('2', 'assistant', 'hello')];
    const mockRuntime: AgentRuntime = {
      run: mock(() => Promise.resolve({ ok: true, value: { content: 'summary' } } as any)),
      stream: mock(() => { throw new Error('not used'); }),
    };
    // Should return without calling AI since toSummarize.length === 0
    await compactSession('sess-1', 'ws-1', msgs, 'claude-sonnet-4-6', mockRuntime);
    expect(mockRuntime.run).not.toHaveBeenCalled();
  });

  it('calls AI with correct model (tier-down) and correct message slice', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(String(i), i % 2 === 0 ? 'user' : 'assistant', `message content ${i}`)
    );

    let capturedInput: any = null;
    const mockRuntime: AgentRuntime = {
      run: mock((input) => {
        capturedInput = input;
        return Promise.resolve({ ok: true, value: { content: 'FACTS ESTABLISHED: none\nCONTEXT: test' } } as any);
      }),
      stream: mock(() => { throw new Error('not used'); }),
    };

    try {
      await compactSession('sess-1', 'ws-1', msgs, 'claude-sonnet-4-6', mockRuntime);
    } catch {
      // DB will fail in unit test — expected
    }

    expect(mockRuntime.run).toHaveBeenCalledTimes(1);
    expect(capturedInput.model).toBe('claude-haiku-4-5-20251001'); // sonnet → haiku
    expect(capturedInput.messages).toHaveLength(4); // 10 - 6 retained = 4 to summarize
    expect(capturedInput.maxTokens).toBe(2048);
    expect(capturedInput.temperature).toBe(0);
  });

  it('does not call AI if summarizer returns error', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(String(i), i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`)
    );
    const mockRuntime: AgentRuntime = {
      run: mock(() => Promise.resolve({ ok: false, error: new Error('AI failed') } as any)),
      stream: mock(() => { throw new Error('not used'); }),
    };
    // Should not throw — just log and return
    await expect(compactSession('sess-1', 'ws-1', msgs, 'claude-sonnet-4-6', mockRuntime)).resolves.toBeUndefined();
    expect(silentLogger.error).toHaveBeenCalledTimes(1);
  });
});
