# Context Compaction Design

## Goal

Automatically compress a session's conversation history when it approaches the model's token limit, preserving agent continuity and coherence while preventing context-overflow errors.

## Context

The schema is pre-prepared:
- `session_messages.isCompacted` (boolean, default false) — marks archived messages
- `session_messages.tokenEstimate` (integer) — per-message estimate
- `sessions.tokenCount` (integer) — running session total
- `sm_session_compacted_idx` on `(sessionId, isCompacted)` — already exists
- `buildContextMessages` already reconstructs context by prepending compacted `system` summaries before active messages

Feature flag `sessions.context-compaction` is declared in `DEFAULT_FLAGS` (populated as part of the usage+flags feature, PR in progress). The compaction service must guard behind this flag.

---

## Architecture

### Trigger

`buildContextMessages` in `sessions.service.ts` is called immediately before every AI invocation. This is the correct trigger point — it has the full message set and returns the final context array. Add a compaction check here:

```
if flag enabled AND sum(active messages tokenEstimate) > THRESHOLD:
  await compactSession(sessionId, active)
  re-fetch and return updated context
```

Threshold: **78% of the model's declared context window**, falling back to a conservative default of **120,000 tokens** (fits Claude Sonnet 4.6's 200k window with headroom for response + summary).

Constant: `COMPACTION_THRESHOLD_TOKENS = 120_000` (configurable via flag `sessions.compaction-threshold-tokens` in future).

### Compaction Flow

```
compactSession(sessionId, activeMessages):
  1. Select messages to summarize: all active EXCEPT the last 6 turns
     (preserve immediate conversational coherence)
  2. Call summarizer model (claude-haiku-4-5) with structured prompt
     Input: messages to summarize as user/assistant turns
     Output: structured summary text
  3. db.transaction:
     a. UPDATE session_messages SET isCompacted = true
        WHERE sessionId = ? AND id IN (messagesToSummarize)
     b. INSERT session_messages (sessionId, role='system', content=summary, isCompacted=true,
        tokenEstimate=estimate(summary))
  4. Publish Topics.SESSION_COMPACTED event
  5. Return (buildContextMessages re-fetches)
```

Step 2 happens **before** the transaction. If the LLM call fails, no DB state is mutated — safe to retry. The transaction in step 3 is purely DB work (fast, atomic).

### Summary Prompt

System prompt passed to the summarizer:

```
You are compressing an AI agent conversation into a durable memory summary.
Produce a structured summary with exactly these sections:

FACTS ESTABLISHED: Bullet list of concrete facts (IDs, values, entity names, constraints confirmed).

DECISIONS MADE: Bullet list of decisions and the reasoning given at the time.

TOOL RESULTS: For each meaningful tool call result, one line: tool name | key inputs | key output.

OPEN TASKS: Work in progress or explicitly deferred.

CONTEXT: 2-3 sentences describing the overall session goal and current state.

Be precise. Preserve specific values (IDs, names, numbers). Do not omit constraints or rules stated by the user.
```

### Recursive Compaction

If after compaction the new active window still exceeds the threshold (e.g., the summary itself is large + 6 retained turns are very long), run a second compaction pass immediately, retaining only the last 2 turns. Hard limit: 2 passes. If still over threshold after 2 passes, log a warning and proceed — the model may truncate but we do not infinite-loop.

### Model Selection

Use a model **one tier below** the session's primary model for summarization (structured extraction does not need full reasoning power):

| Session model | Summarizer |
|---|---|
| claude-opus-4-6 | claude-sonnet-4-6 |
| claude-sonnet-4-6 | claude-haiku-4-5-20251001 |
| claude-haiku-4-5-20251001 | claude-haiku-4-5-20251001 |
| (any OpenAI/Google model) | claude-haiku-4-5-20251001 |

`compactSession` calls the AI provider **directly** via `AgentRuntime.run` (not through `sessionsService`). This is critical: `buildContextMessages` must never be re-entered during a compaction call.

---

## New Files

| File | Role |
|---|---|
| `src/modules/sessions/compaction.service.ts` | `compactSession()` — orchestrates summarize + DB transaction |
| `src/modules/sessions/compaction.prompts.ts` | Summary system prompt constant |

## Modified Files

| File | Change |
|---|---|
| `src/modules/sessions/sessions.service.ts` | Wire compaction check into `buildContextMessages` |
| `src/events/topics.ts` | Add `SESSION_COMPACTED` topic |
| `src/modules/sessions/index.ts` | Export compaction service |

---

## Event Payload

```typescript
Topics.SESSION_COMPACTED → {
  sessionId: string,
  workspaceId: string,
  messagesCompacted: number,
  summaryTokens: number,
  activeTokensBefore: number,
  activeTokensAfter: number,
}
```

---

## Not In Scope

- Checkpoint table (`session_checkpoints`) — the `isCompacted` soft-archive provides the audit trail; a separate checkpoint table adds complexity with no additional benefit given the soft-delete approach
- Per-model context window lookup — use the conservative fixed threshold for V1; model-aware thresholds are a follow-up
- Manual compaction API endpoint — trigger is automatic only for V1

---

## Verification

1. Session with 200+ messages: `buildContextMessages` triggers compaction, old messages have `isCompacted=true`, one new summary system message inserted
2. Compacted messages are excluded from active context but visible via `getTranscript` (which includes all rows)
3. If LLM call for summary fails, no rows are modified (retry-safe)
4. `SESSION_COMPACTED` event fires with correct token counts
5. `sessions.context-compaction` flag = false → compaction never triggers
6. Recursive: session where summary + 6 retained turns still exceed threshold → second pass runs, only 2 turns retained
