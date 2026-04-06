# Context Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compress a session's conversation history when active messages exceed 120,000 tokens, preserving agent continuity via a structured summary injected as a system message.

**Architecture:** A `compactSession` function in `src/modules/sessions/compaction.service.ts` calls a cheap Anthropic model (tier-down from session model) to produce a structured summary, then atomically soft-archives old messages and inserts the summary in a single DB transaction. `buildContextMessages` in `sessions.service.ts` checks the token count before returning context and triggers compaction when needed.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, Anthropic SDK (`AnthropicRawRuntime`), bun:test

---

## File Map

| File | Action | Role |
|---|---|---|
| `src/modules/sessions/compaction.prompts.ts` | Create | Summary system prompt constant |
| `src/modules/sessions/compaction.service.ts` | Create | `resolveSummarizerModel`, `compactSession` |
| `src/modules/sessions/__tests__/compaction.test.ts` | Create | Unit tests for both functions |
| `src/events/topics.ts` | Modify | Add `SESSION_COMPACTED` |
| `src/modules/sessions/sessions.service.ts` | Modify | Wire compaction into `buildContextMessages` |
| `src/modules/sessions/index.ts` | Modify | Export `compactSession` |

---

### Task 1: `resolveSummarizerModel` — pure function + tests

**Files:**
- Create: `src/modules/sessions/compaction.service.ts`
- Create: `src/modules/sessions/__tests__/compaction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/sessions/__tests__/compaction.test.ts
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /path/to/backend && bun test src/modules/sessions/__tests__/compaction.test.ts
```

Expected: `Cannot find module '../compaction.service'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/modules/sessions/compaction.service.ts

const SUMMARIZER_FLOOR = 'claude-haiku-4-5-20251001';

const MODEL_TIER_DOWN: Record<string, string> = {
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': SUMMARIZER_FLOOR,
  'claude-haiku-4-5-20251001': SUMMARIZER_FLOOR,
};

export function resolveSummarizerModel(sessionModel: string): string {
  return MODEL_TIER_DOWN[sessionModel] ?? SUMMARIZER_FLOOR;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
bun test src/modules/sessions/__tests__/compaction.test.ts
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/modules/sessions/compaction.service.ts src/modules/sessions/__tests__/compaction.test.ts
git commit -m "feat(sessions): add resolveSummarizerModel with tier-down logic"
```

---

### Task 2: Compaction prompt constant

**Files:**
- Create: `src/modules/sessions/compaction.prompts.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/modules/sessions/compaction.prompts.ts

export const COMPACTION_SYSTEM_PROMPT = `You are compressing an AI agent conversation into a durable memory summary.
Produce a structured summary with exactly these sections:

FACTS ESTABLISHED: Bullet list of concrete facts (IDs, values, entity names, constraints confirmed).

DECISIONS MADE: Bullet list of decisions and the reasoning given at the time.

TOOL RESULTS: For each meaningful tool call result, one line: tool name | key inputs | key output. Omit failed or redundant calls.

OPEN TASKS: Work in progress or explicitly deferred.

CONTEXT: 2-3 sentences describing the overall session goal and current state.

Be precise. Preserve specific values (IDs, names, numbers). Do not omit constraints or rules stated by the user.`;
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/sessions/compaction.prompts.ts
git commit -m "feat(sessions): add compaction summary system prompt"
```

---

### Task 3: `compactSession` function + tests (mocked AI)

**Files:**
- Modify: `src/modules/sessions/compaction.service.ts`
- Modify: `src/modules/sessions/__tests__/compaction.test.ts`
- Modify: `src/events/topics.ts`

**Background:** `compactSession` must NOT call `sessionsService` or `buildContextMessages` — it calls the AI runtime directly to avoid re-entrant compaction. It takes an optional `runtime` parameter for testability.

The function:
1. Keeps the last `KEEP_LAST_N` (6) active messages outside compaction
2. Calls the AI summarizer with messages to archive
3. In a single DB transaction: marks old messages `isCompacted=true`, inserts summary system message
4. Publishes `SESSION_COMPACTED` event

- [ ] **Step 1: Add `SESSION_COMPACTED` to topics**

Edit `src/events/topics.ts` — add inside the `Topics` object after `SESSION_CLOSED`:

```typescript
  SESSION_COMPACTED: 'session.compacted',
```

- [ ] **Step 2: Write the failing tests for `compactSession`**

Add to `src/modules/sessions/__tests__/compaction.test.ts`:

```typescript
import { mock } from 'bun:test';
import { compactSession } from '../compaction.service';
import type { SessionMessage } from '../sessions.types';
import type { AgentRuntime, RunResult } from '../../../infra/ai/types';
import type { Result } from '../../../core/result';

// Helper: create a minimal SessionMessage
function makeMsg(id: string, role: 'user' | 'assistant' | 'system', content: string): SessionMessage {
  return {
    id,
    sessionId: 'sess-1',
    role,
    content,
    isCompacted: false,
    createdAt: new Date(),
    tokenEstimate: Math.ceil(content.length / 3.2),
  };
}

describe('compactSession', () => {
  it('does nothing when fewer than KEEP_LAST_N + 1 messages', async () => {
    const msgs = [makeMsg('1', 'user', 'hi'), makeMsg('2', 'assistant', 'hello')];
    const mockRuntime: AgentRuntime = {
      run: mock(() => Promise.resolve({ ok: true, value: { content: 'summary', usage: { inputTokens: 10, outputTokens: 50 } } } as Result<RunResult>)),
      stream: mock(() => { throw new Error('not used'); }),
    };
    await compactSession('sess-1', 'ws-1', msgs, 'claude-sonnet-4-6', mockRuntime);
    expect(mockRuntime.run).not.toHaveBeenCalled();
  });

  it('calls AI with messages to summarize and writes summary to DB (integration skipped, just verify AI call shape)', async () => {
    // 10 messages: compactSession should archive first 4, keep last 6
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`msg-${i}`, i % 2 === 0 ? 'user' : 'assistant', `message ${i}`),
    );

    let capturedInput: any = null;
    const mockRuntime: AgentRuntime = {
      run: mock((input) => {
        capturedInput = input;
        return Promise.resolve({ ok: true, value: { content: 'FACTS ESTABLISHED: nothing\nCONTEXT: test session' } } as any);
      }),
      stream: mock(() => { throw new Error('not used'); }),
    };

    // We can't hit the real DB in unit tests, so just verify the AI call is made
    // with the right model and the messages-to-summarize slice.
    // The DB part is covered by the integration verification checklist.
    try {
      await compactSession('sess-1', 'ws-1', msgs, 'claude-sonnet-4-6', mockRuntime);
    } catch {
      // DB call will fail in unit test — that's expected
    }

    expect(mockRuntime.run).toHaveBeenCalled();
    expect(capturedInput.model).toBe('claude-haiku-4-5-20251001'); // sonnet → haiku
    // AI receives 4 messages (10 - 6 kept), not all 10
    expect(capturedInput.messages).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run tests — verify new tests fail**

```bash
bun test src/modules/sessions/__tests__/compaction.test.ts
```

Expected: `compactSession is not a function` (or similar import error)

- [ ] **Step 4: Implement `compactSession`**

Add to `src/modules/sessions/compaction.service.ts` (append after `resolveSummarizerModel`):

```typescript
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

export const COMPACTION_THRESHOLD_TOKENS = 120_000;
const KEEP_LAST_N = 6;
const MAX_PASSES = 2;

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
    logger.error({ sessionId, err: result.error }, 'compactSession: summarizer call failed — skipping compaction');
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
  }).catch((err: unknown) => logger.error({ sessionId, err }, 'Failed to publish SESSION_COMPACTED event'));
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
bun test src/modules/sessions/__tests__/compaction.test.ts
```

Expected: `6 passed` (4 from Task 1 + 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/modules/sessions/compaction.service.ts src/modules/sessions/__tests__/compaction.test.ts src/events/topics.ts
git commit -m "feat(sessions): add compactSession with soft-archive, AI summarization, and SESSION_COMPACTED event"
```

---

### Task 4: Wire compaction into `buildContextMessages`

**Files:**
- Modify: `src/modules/sessions/sessions.service.ts`
- Modify: `src/modules/sessions/index.ts`

**Background:** `buildContextMessages` already returns `[...summaries, ...active]`. We add a check before returning: if active message tokens exceed `COMPACTION_THRESHOLD_TOKENS` and `Bun.env.CONTEXT_COMPACTION_ENABLED === 'true'`, call `compactSession` then re-fetch. A `pass` counter limits recursive compaction to `MAX_PASSES = 2`.

The session's model is not stored on the `Session` row — it's passed in by the caller. Add `sessionModel` as a parameter to `buildContextMessages`.

- [ ] **Step 1: Update `buildContextMessages` signature and body**

Replace the existing `buildContextMessages` method in `src/modules/sessions/sessions.service.ts`:

```typescript
import { compactSession, COMPACTION_THRESHOLD_TOKENS } from './compaction.service';

// inside sessionsService:

async buildContextMessages(
  sessionId: string,
  opts: { workspaceId: string; sessionModel: string; _pass?: number } = { workspaceId: '', sessionModel: '' },
): Promise<Message[]> {
  const allMessages = await sessionsRepo.getMessages(sessionId, { limit: 1000 });
  const summaries: Message[] = [];
  const active: Message[] = [];

  for (const m of allMessages) {
    if (m.isCompacted && m.role === 'system') {
      summaries.push({ role: 'system', content: m.content });
    } else if (!m.isCompacted) {
      active.push({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      });
    }
  }

  const pass = opts._pass ?? 0;
  const compactionEnabled = Bun.env.CONTEXT_COMPACTION_ENABLED === 'true';
  const activeTokens = allMessages
    .filter((m) => !m.isCompacted)
    .reduce((sum, m) => sum + (m.tokenEstimate ?? 0), 0);

  if (compactionEnabled && activeTokens > COMPACTION_THRESHOLD_TOKENS && pass < 2) {
    await compactSession(sessionId, opts.workspaceId, allMessages.filter((m) => !m.isCompacted), opts.sessionModel);
    return this.buildContextMessages(sessionId, { ...opts, _pass: pass + 1 });
  }

  return [...summaries, ...active];
},
```

- [ ] **Step 2: Update `index.ts` to export `compactSession`**

Replace `src/modules/sessions/index.ts`:

```typescript
export { sessionsService } from './sessions.service';
export { sessionsRepo } from './sessions.repo';
export { compactSession, resolveSummarizerModel, COMPACTION_THRESHOLD_TOKENS } from './compaction.service';
export type { Session, SessionMessage, SessionStatus, AddMessageInput } from './sessions.types';
```

- [ ] **Step 3: Run all session tests**

```bash
bun test src/modules/sessions/
```

Expected: all existing tests pass + 6 compaction tests pass. If `buildContextMessages` callers don't pass `opts`, TypeScript will still compile (the parameter has a default value). If callers need updating, the TypeScript compiler will flag them — check with:

```bash
bun run build 2>&1 | grep -i "buildContextMessages"
```

Fix any callers that require `workspaceId` and `sessionModel` (they'll need to thread these values through).

- [ ] **Step 4: Commit**

```bash
git add src/modules/sessions/sessions.service.ts src/modules/sessions/index.ts
git commit -m "feat(sessions): wire compactSession into buildContextMessages with 2-pass recursive limit"
```

---

### Task 5: Run full test suite + verify

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all tests pass (0 failures). If any test fails due to the new `buildContextMessages` signature, update the call site to pass `{ workspaceId: '', sessionModel: '' }` as a safe default.

- [ ] **Step 2: Manual integration check (optional, requires running DB)**

Set `CONTEXT_COMPACTION_ENABLED=true` in `.env.local`, start the dev server, create a session with many messages (or seed one), then call the relevant AI endpoint. Verify:
- Old messages have `isCompacted = true` in the DB
- One new `session_messages` row with `role = 'system'` and `isCompacted = true` (the summary)
- `SESSION_COMPACTED` event fires (check server logs)

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(sessions): context compaction — auto-summarize on token threshold"
```
