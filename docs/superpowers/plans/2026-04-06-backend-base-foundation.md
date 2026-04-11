# Backend Base Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the generic, domain-agnostic backend foundation so that any product (supply chain, finance, HR, etc.) can be plugged in on top without touching core infrastructure.

**Architecture:** The backend is a layered platform — core primitives → infrastructure adapters → domain-agnostic engine → pluggable domain modules. Every feature here must be generic: no mention of suppliers, supply chains, or any specific domain. Domain modules plug in via the tool/skill/hook/event systems.

**Tech Stack:** Bun, Hono + @hono/zod-openapi, Drizzle + PostgreSQL, BullMQ + Redis, @anthropic-ai/sdk + openai + @google/genai, @modelcontextprotocol/sdk, Clerk, Zod v4, Pino

---

## What Already Exists (Do NOT rebuild)

- ✅ EventBus with MQTT-style topics, dead letters, history, group subs (`src/events/bus.ts`)
- ✅ Topics constant + Topic union type (`src/events/topics.ts`) — currently being improved
- ✅ LifecycleHookRegistry (14 events, global + workspace-scoped, blocking + notify) (`src/core/hooks/`)
- ✅ Unified Gateway with 27 ops (`src/core/gateway/gateway.ts`)
- ✅ GatewayClient typed programmatic client (`src/core/gateway/gateway-client.ts`)
- ✅ AI provider abstraction — AgentRuntime, RunInput, RunResult, StreamEvent (`src/infra/ai/types.ts`)
- ✅ Multi-provider runtimes — Anthropic (raw + agent-sdk), OpenAI (raw + agent-sdk), Google (`src/infra/ai/`)
- ✅ withRetryRuntime with retryable classification (`src/infra/ai/runtime-factory.ts`)
- ✅ Tool registry, Skill registry, skill dispatch (`src/modules/tools/`, `src/modules/skills/`)
- ✅ ToolDefinition with `deferLoading` flag (`src/infra/ai/types.ts:38`)
- ✅ Agent infrastructure, A2A protocol, BullMQ workers (`src/infra/a2a/`, `src/modules/agents/`, `src/jobs/agents/`)
- ✅ Memory system (save, recall, propose, approve, reject) (`src/modules/memory/`)
- ✅ Orchestration engine with gates (`src/modules/orchestration/`)
- ✅ Collaboration engine (`src/modules/collaboration/`)
- ✅ Session management (`src/modules/sessions/`)
- ✅ Context/token budget management (`src/modules/context/`)
- ✅ RBAC + sandbox (`src/core/security/`)
- ✅ MCP server + client pool (`src/infra/mcp/`)
- ✅ Real-time: WebSocket + SSE (`src/infra/realtime/`)
- ✅ Feature flags module (`src/modules/feature-flags/`)
- ✅ ScopedConfigStore global→tenant→workspace→user (`src/core/config/`)
- ✅ Result<T,E>, ok/err (`src/core/result/`)
- ✅ AppError hierarchy with AI error classification (`src/core/errors/`)
- ✅ Observability: Sentry + OTel stub (`src/infra/observability/`)
- ✅ Bootstrap initialization chain (`src/app/bootstrap.ts`)

---

## Gap Analysis — What Needs to Be Built

The following are all generic, domain-agnostic, and currently missing:

| # | Gap | Where |
|---|-----|--------|
| 1 | Branded ID types (SessionId, TaskId, AgentId…) | `src/core/types/` |
| 2 | `lazySchema` memoization utility | `src/core/utils/` |
| 3 | `buildTool` typed contract factory | `src/core/tools/` |
| 4 | 5-layer Permission Pipeline | `src/core/permissions/` |
| 5 | Hook events expansion (add 9 missing events) | `src/core/hooks/` |
| 6 | Intent Gate / Model Router | `src/core/ai/` |
| 7 | Multi-provider AI fallback chain | `src/infra/ai/` |
| 8 | Deferred Tool Discovery (ToolSearch) | `src/core/tools/` |
| 9 | Session transcript chain + forking | `src/modules/sessions/` |
| 10 | Context Compaction Service | `src/modules/sessions/` |
| 11 | 3-scope Memory + auto-extraction | `src/modules/memory/` |
| 12 | SSE sequence numbers + client resumption | `src/infra/realtime/` |
| 13 | Batch Event Uploader (backpressured webhook delivery) | `src/infra/webhooks/` |
| 14 | Coordinator Mode (research→plan→implement→verify) | `src/modules/orchestration/` |
| 15 | Verification Agent (built-in adversarial QA) | `src/modules/agents/` |
| 16 | env.ts — add missing infra env vars | `src/config/env.ts` |
| 17 | Clean domain events dir (make fully generic) | `src/events/domain/` |

---

## File Map

```
src/core/types/ids.ts                          NEW  — Branded ID types
src/core/utils/lazy-schema.ts                  NEW  — lazySchema() memoization
src/core/tools/tool-contract.ts                NEW  — buildTool() factory + full typed contract
src/core/tools/tool-search.ts                  NEW  — ToolSearch (deferred tool discovery)
src/core/tools/index.ts                        NEW  — re-exports
src/core/permissions/permission-pipeline.ts    NEW  — 5-layer PermissionPipeline
src/core/permissions/types.ts                  NEW  — PermissionMode, PermissionResult, PermissionDecisionReason
src/core/permissions/index.ts                  NEW  — re-exports
src/core/hooks/hook-registry.ts                MOD  — add 9 missing HookEvent variants
src/core/ai/intent-gate.ts                     NEW  — IntentGate: classify prompt → cost tier
src/core/ai/model-router.ts                    NEW  — ModelRouter: tier → cheapest capable model
src/core/ai/index.ts                           NEW  — re-exports
src/infra/ai/runtime-factory.ts                MOD  — add withFallbackRuntime() provider chain
src/infra/realtime/sse-sequence.ts             NEW  — SSE sequence tracking + resumption protocol
src/infra/webhooks/batch-uploader.ts           NEW  — BatchEventUploader with backpressure
src/modules/sessions/transcript-chain.ts       NEW  — parentMessageId chain + forkSession()
src/modules/sessions/compaction.ts             NEW  — Context compaction service
src/modules/memory/scoped-memory.ts            NEW  — 3-scope memory (user/workspace/global)
src/modules/memory/auto-extract.ts             NEW  — Post-turn memory auto-extraction
src/modules/orchestration/coordinator.ts       NEW  — CoordinatorMode (phase-based orchestration)
src/modules/agents/verification-agent.ts       NEW  — Adversarial verification built-in agent
src/events/domain/registry.ts                  MOD  — Make fully generic (remove supply-chain entities)
src/events/domain/types.ts                     MOD  — Generic entity types only
src/config/env.ts                              MOD  — Add missing env vars
```

---

## Task 1: Branded ID Types

**Files:**
- Create: `src/core/types/ids.ts`
- Modify: `src/core/types/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/core/types/__tests__/ids.test.ts
import { describe, it, expect } from 'bun:test';
import { toSessionId, toTaskId, toAgentId, toWorkspaceId, isValidId } from '../ids';

describe('Branded ID types', () => {
  it('toSessionId creates branded type', () => {
    const id = toSessionId('sess_abc123');
    expect(id).toBe('sess_abc123');
  });

  it('isValidId rejects empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('isValidId rejects strings with path-traversal chars', () => {
    expect(isValidId('../etc/passwd')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
  });

  it('isValidId accepts alphanumeric + underscore + hyphen', () => {
    expect(isValidId('sess_abc-123')).toBe(true);
  });

  it('toAgentId throws on invalid format', () => {
    expect(() => toAgentId('bad id!')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/core/types/__tests__/ids.test.ts
```
Expected: FAIL — `Cannot find module '../ids'`

- [ ] **Step 3: Implement branded IDs**

```typescript
// src/core/types/ids.ts

/** Safe ID pattern — only alphanumeric, underscore, hyphen. Prevents path traversal. */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidId(id: string): boolean {
  return id.length > 0 && SAFE_ID_RE.test(id);
}

function brand<T extends string>(id: string, label: string): T {
  if (!isValidId(id)) throw new Error(`Invalid ${label} ID: "${id}"`);
  return id as T;
}

export type SessionId   = string & { readonly __brand: 'SessionId' };
export type TaskId      = string & { readonly __brand: 'TaskId' };
export type AgentId     = string & { readonly __brand: 'AgentId' };
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type UserId      = string & { readonly __brand: 'UserId' };
export type SkillId     = string & { readonly __brand: 'SkillId' };
export type ToolId      = string & { readonly __brand: 'ToolId' };
export type MemoryId    = string & { readonly __brand: 'MemoryId' };
export type HookId      = string & { readonly __brand: 'HookId' };

export const toSessionId   = (id: string): SessionId   => brand(id, 'Session');
export const toTaskId      = (id: string): TaskId      => brand(id, 'Task');
export const toAgentId     = (id: string): AgentId     => brand(id, 'Agent');
export const toWorkspaceId = (id: string): WorkspaceId => brand(id, 'Workspace');
export const toUserId      = (id: string): UserId      => brand(id, 'User');
export const toSkillId     = (id: string): SkillId     => brand(id, 'Skill');
export const toToolId      = (id: string): ToolId      => brand(id, 'Tool');
export const toMemoryId    = (id: string): MemoryId    => brand(id, 'Memory');
export const toHookId      = (id: string): HookId      => brand(id, 'Hook');
```

- [ ] **Step 4: Export from types index**

In `src/core/types/index.ts`, add:
```typescript
export * from './ids';
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test src/core/types/__tests__/ids.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/types/ids.ts src/core/types/index.ts src/core/types/__tests__/ids.test.ts
git commit -m "feat(core): add branded ID types with path-traversal protection"
```

---

## Task 2: lazySchema Memoization Utility

**Files:**
- Create: `src/core/utils/lazy-schema.ts`
- Modify: `src/core/utils/index.ts` (add export)

- [ ] **Step 1: Write failing test**

```typescript
// src/core/utils/__tests__/lazy-schema.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { lazySchema } from '../lazy-schema';
import { z } from 'zod';

describe('lazySchema', () => {
  it('calls factory only once across multiple invocations', () => {
    let calls = 0;
    const schema = lazySchema(() => { calls++; return z.object({ x: z.string() }); });
    schema(); schema(); schema();
    expect(calls).toBe(1);
  });

  it('returns the same schema instance every call', () => {
    const schema = lazySchema(() => z.string());
    expect(schema()).toBe(schema());
  });

  it('schema validates correctly', () => {
    const schema = lazySchema(() => z.object({ name: z.string() }));
    expect(schema().parse({ name: 'test' })).toEqual({ name: 'test' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/core/utils/__tests__/lazy-schema.test.ts
```
Expected: FAIL — `Cannot find module '../lazy-schema'`

- [ ] **Step 3: Implement**

```typescript
// src/core/utils/lazy-schema.ts

/**
 * Defers Zod schema construction until first use.
 * Prevents top-level module-init cost for schemas that may never be called.
 *
 * Usage:
 *   export const mySchema = lazySchema(() => z.object({ ... }));
 *   // Call as: mySchema().parse(input)
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= factory());
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/core/utils/__tests__/lazy-schema.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/lazy-schema.ts src/core/utils/__tests__/lazy-schema.test.ts
git commit -m "feat(core): add lazySchema memoization utility"
```

---

## Task 3: Hook Events Expansion

**Files:**
- Modify: `src/core/hooks/hook-registry.ts`

The current 14 events are missing: `pre_compact`, `post_compact`, `permission_denied`, `subagent_start`, `subagent_stop`, `file_changed`, `tool_discovery`, `memory_extracted`, `workflow_gate`.

- [ ] **Step 1: Write failing test**

```typescript
// src/core/hooks/__tests__/hook-registry.test.ts
import { describe, it, expect } from 'bun:test';
import { lifecycleHooks } from '../hook-registry';
import type { HookEvent } from '../hook-registry';

const ALL_EXPECTED_EVENTS: HookEvent[] = [
  'pre_tool_use', 'post_tool_use',
  'task_created', 'task_completed', 'task_failed', 'task_interrupted',
  'approval_requested', 'approval_resolved',
  'input_required', 'input_received',
  'agent_start', 'agent_stop',
  'session_start', 'session_end',
  'pre_compact', 'post_compact',
  'permission_denied',
  'subagent_start', 'subagent_stop',
  'memory_extracted',
  'workflow_gate',
];

describe('LifecycleHookRegistry', () => {
  it('fires hook for pre_compact event', async () => {
    lifecycleHooks.clear();
    let fired = false;
    lifecycleHooks.registerGlobal({
      id: 'test-compact',
      event: 'pre_compact',
      handler: async () => { fired = true; return { allow: true }; },
    });
    await lifecycleHooks.run('pre_compact', { sessionId: 's1', reason: 'token_limit' }, { workspaceId: 'w1', callerId: 'u1' });
    expect(fired).toBe(true);
    lifecycleHooks.clear();
  });

  it('fires hook for permission_denied event', async () => {
    lifecycleHooks.clear();
    let payload: unknown;
    lifecycleHooks.registerGlobal({
      id: 'test-denied',
      event: 'permission_denied',
      handler: async (_, p) => { payload = p; },
    });
    await lifecycleHooks.run('permission_denied', { toolName: 'bash', reason: 'blocked by rule' }, { workspaceId: 'w1', callerId: 'u1' });
    expect((payload as any).toolName).toBe('bash');
    lifecycleHooks.clear();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/core/hooks/__tests__/hook-registry.test.ts
```
Expected: FAIL — `pre_compact` not in HookEvent union

- [ ] **Step 3: Expand HookEvent and HookPayloadMap**

In `src/core/hooks/hook-registry.ts`, replace the existing `HookEvent` type and `HookPayloadMap` interface:

```typescript
export type HookEvent =
  // Tool lifecycle
  | 'pre_tool_use'
  | 'post_tool_use'
  // Task lifecycle
  | 'task_created'
  | 'task_completed'
  | 'task_failed'
  | 'task_interrupted'
  // Approval flow
  | 'approval_requested'
  | 'approval_resolved'
  // Human-in-the-loop input
  | 'input_required'
  | 'input_received'
  // Agent lifecycle
  | 'agent_start'
  | 'agent_stop'
  | 'subagent_start'
  | 'subagent_stop'
  // Session lifecycle
  | 'session_start'
  | 'session_end'
  // Compaction
  | 'pre_compact'
  | 'post_compact'
  // Security
  | 'permission_denied'
  // Memory
  | 'memory_extracted'
  // Workflow
  | 'workflow_gate';

export interface HookPayloadMap {
  pre_tool_use:        { name: string; args: Record<string, unknown> };
  post_tool_use:       { name: string; args: Record<string, unknown>; result: { ok: boolean; value?: unknown; error?: unknown } };
  task_created:        { taskId: string; agentId: string; message?: string };
  task_completed:      { taskId: string; result?: unknown };
  task_failed:         { taskId: string; error: string };
  task_interrupted:    { taskId: string };
  approval_requested:  { approvalId: string; taskId: string; toolName: string; args: unknown };
  approval_resolved:   { approvalId: string; approved: boolean; updatedInput?: Record<string, unknown> };
  input_required:      { taskId: string; prompt: string };
  input_received:      { taskId: string; input: unknown };
  agent_start:         { agentId: string; taskId?: string };
  agent_stop:          { agentId: string; taskId?: string; reason?: string };
  subagent_start:      { parentAgentId: string; subagentId: string; taskId: string };
  subagent_stop:       { parentAgentId: string; subagentId: string; result?: unknown };
  session_start:       { sessionId: string };
  session_end:         { sessionId: string; reason?: string };
  pre_compact:         { sessionId: string; reason: 'token_limit' | 'manual' };
  post_compact:        { sessionId: string; summaryTokens: number; droppedMessages: number };
  permission_denied:   { toolName: string; reason: string; decisionLayer: string };
  memory_extracted:    { sessionId: string; memories: Array<{ type: string; body: string }> };
  workflow_gate:       { orchestrationId: string; gateId: string; question: string };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/core/hooks/__tests__/hook-registry.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/hooks/hook-registry.ts src/core/hooks/__tests__/hook-registry.test.ts
git commit -m "feat(core): expand hook events to 23 lifecycle points"
```

---

## Task 4: buildTool Typed Contract Factory

**Files:**
- Create: `src/core/tools/tool-contract.ts`
- Create: `src/core/tools/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/core/tools/__tests__/tool-contract.test.ts
import { describe, it, expect } from 'bun:test';
import { buildTool } from '../tool-contract';
import { z } from 'zod';

describe('buildTool', () => {
  const echoTool = buildTool({
    name: 'echo',
    description: 'Echoes input back',
    inputSchema: z.object({ message: z.string() }),
    async execute({ message }) { return { output: message }; },
  });

  it('applies fail-closed defaults', () => {
    expect(echoTool.isConcurrencySafe).toBe(false);
    expect(echoTool.isReadOnly).toBe(false);
    expect(echoTool.isDestructive).toBe(false);
    expect(echoTool.shouldDefer).toBe(false);
    expect(echoTool.maxOutputChars).toBe(100_000);
  });

  it('preserves overridden values', () => {
    const readOnlyTool = buildTool({
      name: 'read',
      description: 'Reads a file',
      inputSchema: z.object({ path: z.string() }),
      isReadOnly: true,
      isConcurrencySafe: true,
      maxOutputChars: 50_000,
      async execute({ path }) { return { content: path }; },
    });
    expect(readOnlyTool.isReadOnly).toBe(true);
    expect(readOnlyTool.isConcurrencySafe).toBe(true);
    expect(readOnlyTool.maxOutputChars).toBe(50_000);
  });

  it('execute is callable', async () => {
    const result = await echoTool.execute({ message: 'hello' });
    expect(result).toEqual({ output: 'hello' });
  });

  it('deferred tool has shouldDefer true', () => {
    const deferred = buildTool({
      name: 'rare-tool',
      description: 'Rarely used',
      inputSchema: z.object({ x: z.number() }),
      shouldDefer: true,
      async execute({ x }) { return { x }; },
    });
    expect(deferred.shouldDefer).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/core/tools/__tests__/tool-contract.test.ts
```
Expected: FAIL — `Cannot find module '../tool-contract'`

- [ ] **Step 3: Implement buildTool**

```typescript
// src/core/tools/tool-contract.ts
import type { z } from 'zod';

/** Defaults applied to every tool — fail-closed. */
const TOOL_DEFAULTS = {
  isConcurrencySafe: false,   // assume not safe for concurrent use
  isReadOnly: false,          // assume writes by default (more restrictive)
  isDestructive: false,       // assume non-destructive by default
  shouldDefer: false,         // included in context by default
  alwaysLoad: false,          // not forced into context
  maxOutputChars: 100_000,    // 100K char output budget
} as const;

export interface ToolDefinition<TInput extends z.ZodTypeAny, TOutput> {
  /** Unique tool name — used in LLM tool calls. */
  name: string;
  /** Human-readable description — shown to the LLM. */
  description: string;
  /** Zod schema for tool input validation. */
  inputSchema: TInput;
  /** Core tool execution logic. */
  execute(input: z.infer<TInput>): Promise<TOutput>;
  /**
   * Whether multiple calls to this tool with different inputs can run in parallel.
   * Default: false (conservative).
   */
  isConcurrencySafe?: boolean;
  /** Whether this tool only reads state (never writes). Default: false. */
  isReadOnly?: boolean;
  /** Whether this tool can cause permanent data loss. Default: false. */
  isDestructive?: boolean;
  /**
   * When true, the tool is NOT included in the initial LLM context.
   * The model must call ToolSearch first to discover it.
   * Use for rarely-needed tools to save context budget.
   */
  shouldDefer?: boolean;
  /** When true, always loaded into context regardless of budget. Default: false. */
  alwaysLoad?: boolean;
  /** Max characters in tool output before truncation. Default: 100_000. */
  maxOutputChars?: number;
  /** Optional search hint for deferred tool discovery. */
  searchHint?: string;
}

export type BuiltTool<TInput extends z.ZodTypeAny, TOutput> =
  Required<Omit<ToolDefinition<TInput, TOutput>, 'searchHint'>> &
  Pick<ToolDefinition<TInput, TOutput>, 'searchHint'>;

/**
 * Factory that builds a fully-specified tool with fail-closed defaults.
 *
 * Usage:
 *   export const myTool = buildTool({
 *     name: 'my_tool',
 *     description: 'Does something',
 *     inputSchema: z.object({ param: z.string() }),
 *     isReadOnly: true,
 *     async execute({ param }) { return { result: param }; },
 *   });
 */
export function buildTool<TInput extends z.ZodTypeAny, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
): BuiltTool<TInput, TOutput> {
  return { ...TOOL_DEFAULTS, ...def } as BuiltTool<TInput, TOutput>;
}
```

- [ ] **Step 4: Create index**

```typescript
// src/core/tools/index.ts
export * from './tool-contract';
export * from './tool-search';  // will be created in Task 8
```

Note: `tool-search` doesn't exist yet — create the index without that export for now, add it after Task 8.

```typescript
// src/core/tools/index.ts
export * from './tool-contract';
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test src/core/tools/__tests__/tool-contract.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/tool-contract.ts src/core/tools/index.ts src/core/tools/__tests__/tool-contract.test.ts
git commit -m "feat(core): add buildTool factory with fail-closed typed contract"
```

---

## Task 5: Permission Pipeline (5 Layers)

**Files:**
- Create: `src/core/permissions/types.ts`
- Create: `src/core/permissions/permission-pipeline.ts`
- Create: `src/core/permissions/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/core/permissions/__tests__/permission-pipeline.test.ts
import { describe, it, expect } from 'bun:test';
import { PermissionPipeline } from '../permission-pipeline';
import type { PermissionContext, PermissionResult } from '../types';

const ctx: PermissionContext = { workspaceId: 'w1', callerId: 'u1', toolName: 'bash' };

describe('PermissionPipeline', () => {
  it('allows by default when no layers registered', async () => {
    const pipeline = new PermissionPipeline();
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('allow');
    expect(result.decisionLayer).toBe('default');
  });

  it('deny layer short-circuits immediately', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({
      name: 'deny-all',
      async check(_ctx) { return { behavior: 'deny', reason: 'blocked by policy' }; },
    });
    pipeline.addLayer({
      name: 'should-not-run',
      async check(_ctx) { throw new Error('should not reach here'); },
    });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('deny');
    expect(result.decisionLayer).toBe('deny-all');
    expect(result.reason).toBe('blocked by policy');
  });

  it('passthrough continues to next layer', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({ name: 'pass', async check() { return { behavior: 'passthrough' }; } });
    pipeline.addLayer({ name: 'allow', async check() { return { behavior: 'allow' }; } });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('allow');
    expect(result.decisionLayer).toBe('allow');
  });

  it('ask layer returns ask with message', async () => {
    const pipeline = new PermissionPipeline();
    pipeline.addLayer({
      name: 'ask-layer',
      async check() { return { behavior: 'ask', message: 'Confirm this action?' }; },
    });
    const result = await pipeline.check(ctx);
    expect(result.behavior).toBe('ask');
    expect(result.message).toBe('Confirm this action?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/core/permissions/__tests__/permission-pipeline.test.ts
```

- [ ] **Step 3: Create types**

```typescript
// src/core/permissions/types.ts

export interface PermissionContext {
  workspaceId: string;
  callerId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  taskId?: string;
  /** Current permission mode for this workspace/session. */
  mode?: PermissionMode;
}

export type PermissionMode =
  | 'default'           // normal — ask on destructive actions
  | 'bypassPermissions' // agent mode — skip all prompts (trusted callers only)
  | 'dontAsk'           // never ask user — auto-allow or auto-deny by rules
  | 'plan'              // plan mode — read-only, deny all writes
  | 'acceptEdits';      // always accept file edits without asking

export type PermissionBehavior = 'allow' | 'deny' | 'ask' | 'passthrough';

export type PermissionResult =
  | { behavior: 'allow';       decisionLayer: string; reason?: string }
  | { behavior: 'deny';        decisionLayer: string; reason: string }
  | { behavior: 'ask';         decisionLayer: string; message: string }
  | { behavior: 'passthrough'; decisionLayer: string };

export interface PermissionLayer {
  /** Unique name for this layer — used in decisionLayer field of results. */
  name: string;
  check(ctx: PermissionContext): Promise<Omit<PermissionResult, 'decisionLayer'>>;
}
```

- [ ] **Step 4: Create pipeline**

```typescript
// src/core/permissions/permission-pipeline.ts
import type { PermissionContext, PermissionLayer, PermissionResult } from './types';

/**
 * 5-layer permission decision pipeline.
 *
 * Layers run in order. First non-passthrough result wins.
 * Default layers (in order):
 *   1. Mode layer    — checks PermissionMode (bypassPermissions → allow, plan → deny writes)
 *   2. Rules layer   — static allow/deny rules from workspace settings
 *   3. Hook layer    — lifecycle hooks can approve or deny
 *   4. Classifier    — AI classifier for ambiguous cases (optional, expensive)
 *   5. User prompt   — last resort: surface to human for approval
 *
 * Register layers via addLayer(). Layers run in registration order.
 */
export class PermissionPipeline {
  private layers: PermissionLayer[] = [];

  addLayer(layer: PermissionLayer): this {
    this.layers.push(layer);
    return this;
  }

  removeLayer(name: string): this {
    this.layers = this.layers.filter(l => l.name !== name);
    return this;
  }

  async check(ctx: PermissionContext): Promise<PermissionResult> {
    for (const layer of this.layers) {
      const result = await layer.check(ctx);
      if (result.behavior !== 'passthrough') {
        return { ...result, decisionLayer: layer.name } as PermissionResult;
      }
    }
    // All layers passed through — allow by default
    return { behavior: 'allow', decisionLayer: 'default' };
  }
}

/** Singleton pipeline for the application. Layers registered at startup. */
export const permissionPipeline = new PermissionPipeline();
```

- [ ] **Step 5: Create index**

```typescript
// src/core/permissions/index.ts
export * from './types';
export * from './permission-pipeline';
```

- [ ] **Step 6: Run tests**

```bash
cd backend && bun test src/core/permissions/__tests__/permission-pipeline.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/core/permissions/ 
git commit -m "feat(core): add 5-layer PermissionPipeline with typed decision layers"
```

---

## Task 6: Intent Gate / Model Router

**Files:**
- Create: `src/core/ai/intent-gate.ts`
- Create: `src/core/ai/model-router.ts`
- Create: `src/core/ai/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/core/ai/__tests__/intent-gate.test.ts
import { describe, it, expect } from 'bun:test';
import { classifyIntent } from '../intent-gate';

describe('IntentGate', () => {
  it('classifies short simple queries as lookup', () => {
    expect(classifyIntent('What is the status of task 123?')).toBe('lookup');
  });

  it('classifies analysis requests as analysis', () => {
    expect(classifyIntent('Analyze the performance metrics and identify bottlenecks')).toBe('analysis');
  });

  it('classifies complex multi-step tasks as deep', () => {
    const prompt = 'Research all our integrations, identify gaps, build a migration plan, and implement the first phase';
    expect(classifyIntent(prompt)).toBe('deep');
  });

  it('classifies generation tasks correctly', () => {
    expect(classifyIntent('Generate a comprehensive report')).toBe('generation');
  });
});

// src/core/ai/__tests__/model-router.test.ts
import { describe, it, expect } from 'bun:test';
import { routeModel } from '../model-router';

describe('ModelRouter', () => {
  it('routes lookup to haiku', () => {
    expect(routeModel('lookup', 'anthropic')).toBe('claude-haiku-4-5-20251001');
  });

  it('routes analysis to sonnet', () => {
    expect(routeModel('analysis', 'anthropic')).toBe('claude-sonnet-4-6');
  });

  it('routes deep to opus', () => {
    expect(routeModel('deep', 'anthropic')).toBe('claude-opus-4-6');
  });

  it('routes lookup for openai to cheapest', () => {
    expect(routeModel('lookup', 'openai')).toBe('gpt-4o-mini');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test src/core/ai/__tests__/
```

- [ ] **Step 3: Implement intent-gate.ts**

```typescript
// src/core/ai/intent-gate.ts

export type IntentTier = 'lookup' | 'analysis' | 'generation' | 'deep';

/**
 * Classifies a prompt into a cost tier.
 * Used by ModelRouter to select the cheapest model that can handle the request.
 *
 * Tiers (cheapest → most expensive):
 *   lookup     — simple fact retrieval, status checks, short Q&A
 *   analysis   — multi-factor reasoning, pattern recognition
 *   generation — content creation, summarization, transformation
 *   deep       — complex multi-step, research + implementation, planning
 */
export function classifyIntent(prompt: string): IntentTier {
  const text = prompt.toLowerCase();

  const deepSignals = ['implement', 'research', 'build a plan', 'migration', 'architect', 'design a system', 'comprehensive'];
  if (deepSignals.some(s => text.includes(s)) && prompt.length > 120) return 'deep';

  const generationSignals = ['generate', 'write', 'create a report', 'draft', 'summarize all', 'produce'];
  if (generationSignals.some(s => text.includes(s))) return 'generation';

  const analysisSignals = ['analyze', 'analyse', 'identify', 'compare', 'evaluate', 'assess', 'find patterns'];
  if (analysisSignals.some(s => text.includes(s))) return 'analysis';

  return 'lookup';
}
```

- [ ] **Step 4: Implement model-router.ts**

```typescript
// src/core/ai/model-router.ts
import type { AIProvider } from '../../infra/ai/types';
import type { IntentTier } from './intent-gate';

type ModelMap = Record<IntentTier, string>;

const PROVIDER_MODELS: Record<AIProvider, ModelMap> = {
  anthropic: {
    lookup:     'claude-haiku-4-5-20251001',
    analysis:   'claude-sonnet-4-6',
    generation: 'claude-sonnet-4-6',
    deep:       'claude-opus-4-6',
  },
  openai: {
    lookup:     'gpt-4o-mini',
    analysis:   'gpt-4o',
    generation: 'gpt-4o',
    deep:       'gpt-4o',
  },
  google: {
    lookup:     'gemini-2.0-flash',
    analysis:   'gemini-2.5-pro',
    generation: 'gemini-2.5-pro',
    deep:       'gemini-2.5-pro',
  },
};

/**
 * Returns the cheapest model capable of handling the given intent tier.
 * Override by setting MODEL_OVERRIDE_<TIER> env vars at runtime.
 */
export function routeModel(tier: IntentTier, provider: AIProvider): string {
  const envKey = `MODEL_OVERRIDE_${tier.toUpperCase()}` as keyof typeof process.env;
  const override = process.env[envKey];
  if (override) return override;
  return PROVIDER_MODELS[provider][tier];
}
```

- [ ] **Step 5: Create index**

```typescript
// src/core/ai/index.ts
export * from './intent-gate';
export * from './model-router';
```

- [ ] **Step 6: Run tests**

```bash
cd backend && bun test src/core/ai/__tests__/
```
Expected: PASS (7 tests)

- [ ] **Step 7: Commit**

```bash
git add src/core/ai/
git commit -m "feat(core): add IntentGate + ModelRouter for cost-aware model selection"
```

---

## Task 7: Multi-Provider AI Fallback Chain

**Files:**
- Modify: `src/infra/ai/runtime-factory.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/infra/ai/__tests__/fallback-runtime.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { withFallbackRuntime } from '../runtime-factory';
import type { AgentRuntime, RunInput } from '../types';
import { ok, err } from '../../core/result';
import { AIError } from '../../core/errors';

const input: RunInput = { messages: [{ role: 'user', content: 'hi' }], model: 'test-model' };

function makeRuntime(succeed: boolean): AgentRuntime {
  return {
    async run() {
      if (succeed) return ok({ content: 'response', toolCalls: [] });
      return err(new AIError('provider_down', 'Service unavailable'));
    },
    async *stream() { yield { type: 'done' as const, data: {} }; },
  };
}

describe('withFallbackRuntime', () => {
  it('returns primary result when primary succeeds', async () => {
    const runtime = withFallbackRuntime([makeRuntime(true), makeRuntime(false)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(true);
  });

  it('falls through to secondary when primary fails', async () => {
    const runtime = withFallbackRuntime([makeRuntime(false), makeRuntime(true)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(true);
  });

  it('returns last error when all providers fail', async () => {
    const runtime = withFallbackRuntime([makeRuntime(false), makeRuntime(false)]);
    const result = await runtime.run(input);
    expect(result.ok).toBe(false);
  });

  it('throws when given empty provider list', () => {
    expect(() => withFallbackRuntime([])).toThrow('at least one runtime');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test src/infra/ai/__tests__/fallback-runtime.test.ts
```

- [ ] **Step 3: Add withFallbackRuntime to runtime-factory.ts**

Add at the end of `src/infra/ai/runtime-factory.ts`:

```typescript
/**
 * Wraps multiple runtimes in a fallback chain.
 * Tries each runtime in order. Returns the first successful result.
 * If all fail, returns the last error.
 *
 * Usage:
 *   const runtime = withFallbackRuntime([
 *     createRuntime('anthropic', 'raw'),
 *     createRuntime('openai', 'raw'),
 *   ]);
 */
export function withFallbackRuntime(runtimes: AgentRuntime[]): AgentRuntime {
  if (runtimes.length === 0) throw new Error('withFallbackRuntime requires at least one runtime');
  return {
    async run(input: RunInput): Promise<Result<RunResult>> {
      let lastResult: Result<RunResult> | undefined;
      for (const runtime of runtimes) {
        lastResult = await runtime.run(input);
        if (lastResult.ok) return lastResult;
      }
      return lastResult!;
    },
    async *stream(input: RunInput): AsyncIterable<StreamEvent> {
      // Stream doesn't support fallback — use primary
      yield* runtimes[0].stream(input);
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/infra/ai/__tests__/fallback-runtime.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/infra/ai/runtime-factory.ts src/infra/ai/__tests__/fallback-runtime.test.ts
git commit -m "feat(infra): add withFallbackRuntime for multi-provider failover"
```

---

## Task 8: Deferred Tool Discovery (ToolSearch)

**Files:**
- Create: `src/core/tools/tool-search.ts`
- Modify: `src/core/tools/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/core/tools/__tests__/tool-search.test.ts
import { describe, it, expect } from 'bun:test';
import { ToolSearchRegistry } from '../tool-search';
import { buildTool } from '../tool-contract';
import { z } from 'zod';

const deferredTool = buildTool({
  name: 'rare_export',
  description: 'Export data to CSV format',
  searchHint: 'csv export download',
  inputSchema: z.object({ format: z.string() }),
  shouldDefer: true,
  async execute({ format }) { return { format }; },
});

const alwaysLoadTool = buildTool({
  name: 'core_read',
  description: 'Read a resource',
  inputSchema: z.object({ id: z.string() }),
  alwaysLoad: true,
  async execute({ id }) { return { id }; },
});

describe('ToolSearchRegistry', () => {
  it('registers and searches deferred tools', () => {
    const registry = new ToolSearchRegistry();
    registry.register(deferredTool);
    const results = registry.search('csv');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('rare_export');
  });

  it('does not return non-deferred tools in search', () => {
    const registry = new ToolSearchRegistry();
    registry.register(alwaysLoadTool);
    const results = registry.search('read');
    expect(results).toHaveLength(0);
  });

  it('resolves tool by exact name', () => {
    const registry = new ToolSearchRegistry();
    registry.register(deferredTool);
    const tool = registry.resolve('rare_export');
    expect(tool?.name).toBe('rare_export');
  });

  it('returns null for unknown tool', () => {
    const registry = new ToolSearchRegistry();
    expect(registry.resolve('nonexistent')).toBeNull();
  });

  it('search is case-insensitive', () => {
    const registry = new ToolSearchRegistry();
    registry.register(deferredTool);
    expect(registry.search('CSV')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/core/tools/__tests__/tool-search.test.ts
```

- [ ] **Step 3: Implement ToolSearchRegistry**

```typescript
// src/core/tools/tool-search.ts
import type { BuiltTool } from './tool-contract';
import type { z } from 'zod';

/**
 * Registry for deferred tools.
 *
 * Tools marked shouldDefer: true are NOT included in the LLM's initial context.
 * The LLM calls tool_search to discover them before use.
 *
 * This keeps the initial context window small while still making
 * many specialized tools available on demand.
 */
export class ToolSearchRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tools = new Map<string, BuiltTool<z.ZodTypeAny, any>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(tool: BuiltTool<z.ZodTypeAny, any>): void {
    if (tool.shouldDefer || !tool.alwaysLoad) {
      if (tool.shouldDefer) this.tools.set(tool.name, tool);
    }
  }

  /**
   * Search deferred tools by query string.
   * Matches against name, description, and searchHint.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search(query: string): BuiltTool<z.ZodTypeAny, any>[] {
    const q = query.toLowerCase();
    const results: BuiltTool<z.ZodTypeAny, any>[] = [];
    for (const tool of this.tools.values()) {
      const haystack = [tool.name, tool.description, tool.searchHint ?? ''].join(' ').toLowerCase();
      if (haystack.includes(q)) results.push(tool);
    }
    return results;
  }

  /** Resolve a specific deferred tool by exact name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve(name: string): BuiltTool<z.ZodTypeAny, any> | null {
    return this.tools.get(name) ?? null;
  }
}

export const toolSearchRegistry = new ToolSearchRegistry();
```

- [ ] **Step 4: Update tools index**

```typescript
// src/core/tools/index.ts
export * from './tool-contract';
export * from './tool-search';
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test src/core/tools/__tests__/tool-search.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/tools/tool-search.ts src/core/tools/index.ts src/core/tools/__tests__/tool-search.test.ts
git commit -m "feat(core): add ToolSearchRegistry for deferred tool discovery"
```

---

## Task 9: Session Transcript Chain + Fork

**Files:**
- Create: `src/modules/sessions/transcript-chain.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/sessions/__tests__/transcript-chain.test.ts
import { describe, it, expect } from 'bun:test';
import { TranscriptChain } from '../transcript-chain';

describe('TranscriptChain', () => {
  it('appends messages with auto-generated IDs', () => {
    const chain = new TranscriptChain('session-1');
    const id = chain.append({ role: 'user', content: 'hello' });
    expect(typeof id).toBe('string');
    expect(chain.messages()).toHaveLength(1);
  });

  it('sets parentMessageId on subsequent messages', () => {
    const chain = new TranscriptChain('session-1');
    const id1 = chain.append({ role: 'user', content: 'first' });
    const id2 = chain.append({ role: 'assistant', content: 'second' });
    expect(chain.messages()[1].parentMessageId).toBe(id1);
  });

  it('fork creates a new chain from a checkpoint', () => {
    const chain = new TranscriptChain('session-1');
    const id1 = chain.append({ role: 'user', content: 'first' });
    chain.append({ role: 'assistant', content: 'second' });

    const forked = chain.forkFrom(id1, 'session-2');
    expect(forked.sessionId).toBe('session-2');
    expect(forked.messages()).toHaveLength(1);
    expect(forked.messages()[0].content).toBe('first');
  });

  it('serialize/deserialize round-trips correctly', () => {
    const chain = new TranscriptChain('session-1');
    chain.append({ role: 'user', content: 'hello' });
    chain.append({ role: 'assistant', content: 'world' });

    const serialized = chain.serialize();
    const restored = TranscriptChain.deserialize(serialized);
    expect(restored.messages()).toHaveLength(2);
    expect(restored.sessionId).toBe('session-1');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/modules/sessions/__tests__/transcript-chain.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/modules/sessions/transcript-chain.ts
import { nanoid } from 'nanoid';

export interface TranscriptMessage {
  id: string;
  parentMessageId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface TranscriptEntry {
  role: TranscriptMessage['role'];
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Linked-list transcript chain for a session.
 * Each message has a parentMessageId pointer, enabling:
 *   - Audit trails  — full history with causal links
 *   - Forking       — branch from any checkpoint for A/B exploration
 *   - Replay        — re-run from any message ID
 */
export class TranscriptChain {
  private _messages: TranscriptMessage[] = [];
  readonly sessionId: string;

  constructor(sessionId: string, messages: TranscriptMessage[] = []) {
    this.sessionId = sessionId;
    this._messages = messages;
  }

  /** Append a message. Returns the new message's ID. */
  append(entry: TranscriptEntry): string {
    const id = nanoid();
    const lastId = this._messages.at(-1)?.id ?? null;
    this._messages.push({
      id,
      parentMessageId: lastId,
      role: entry.role,
      content: entry.content,
      createdAt: Date.now(),
      metadata: entry.metadata,
    });
    return id;
  }

  /** All messages in chronological order. */
  messages(): Readonly<TranscriptMessage[]> {
    return this._messages;
  }

  /**
   * Fork the chain from a given message ID into a new session.
   * The forked chain contains all messages up to and including the fork point.
   */
  forkFrom(messageId: string, newSessionId: string): TranscriptChain {
    const idx = this._messages.findIndex(m => m.id === messageId);
    if (idx === -1) throw new Error(`Message ${messageId} not found in session ${this.sessionId}`);
    const snapshot = this._messages.slice(0, idx + 1).map(m => ({ ...m }));
    return new TranscriptChain(newSessionId, snapshot);
  }

  serialize(): string {
    return JSON.stringify({ sessionId: this.sessionId, messages: this._messages });
  }

  static deserialize(json: string): TranscriptChain {
    const { sessionId, messages } = JSON.parse(json);
    return new TranscriptChain(sessionId, messages);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/sessions/__tests__/transcript-chain.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/sessions/transcript-chain.ts src/modules/sessions/__tests__/transcript-chain.test.ts
git commit -m "feat(sessions): add TranscriptChain with parentMessageId links and fork support"
```

---

## Task 10: Context Compaction Service

**Files:**
- Create: `src/modules/sessions/compaction.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/sessions/__tests__/compaction.test.ts
import { describe, it, expect } from 'bun:test';
import { shouldCompact, buildCompactionPayload } from '../compaction';
import type { TranscriptMessage } from '../transcript-chain';

function makeMsg(content: string, role: TranscriptMessage['role'] = 'user'): TranscriptMessage {
  return { id: Math.random().toString(36), parentMessageId: null, role, content, createdAt: Date.now() };
}

describe('Compaction', () => {
  it('does not trigger compaction below threshold', () => {
    const messages = Array.from({ length: 5 }, (_, i) => makeMsg(`msg ${i}`));
    expect(shouldCompact(messages, { maxMessages: 50, tokenBudget: 100_000 })).toBe(false);
  });

  it('triggers compaction when message count exceeds threshold', () => {
    const messages = Array.from({ length: 60 }, (_, i) => makeMsg(`msg ${i}`));
    expect(shouldCompact(messages, { maxMessages: 50, tokenBudget: 100_000 })).toBe(true);
  });

  it('buildCompactionPayload returns head + tail structure', () => {
    const messages = Array.from({ length: 20 }, (_, i) => makeMsg(`msg ${i}`));
    const payload = buildCompactionPayload(messages, { keepHead: 2, keepTail: 5 });
    expect(payload.head).toHaveLength(2);
    expect(payload.tail).toHaveLength(5);
    expect(payload.droppedCount).toBe(13);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/modules/sessions/__tests__/compaction.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/modules/sessions/compaction.ts
import type { TranscriptMessage } from './transcript-chain';

export interface CompactionConfig {
  /** Trigger compaction when session exceeds this many messages. */
  maxMessages: number;
  /** Trigger compaction when estimated token usage exceeds this. */
  tokenBudget: number;
}

export interface CompactionPayload {
  /** Messages kept from session start (system prompt, initial context). */
  head: TranscriptMessage[];
  /** Messages kept from recent conversation. */
  tail: TranscriptMessage[];
  /** Number of messages dropped (to be summarized by LLM). */
  droppedCount: number;
  /** Messages that were dropped — passed to summarizer agent. */
  dropped: TranscriptMessage[];
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(messages: TranscriptMessage[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

/**
 * Returns true if the session should be compacted.
 */
export function shouldCompact(
  messages: TranscriptMessage[],
  config: CompactionConfig,
): boolean {
  if (messages.length > config.maxMessages) return true;
  if (estimateTokens(messages) > config.tokenBudget) return true;
  return false;
}

/**
 * Builds a compaction payload that splits the transcript into head/tail/dropped.
 * The dropped section is sent to a summarizer agent.
 * Head + summarized-dropped + tail form the new compacted context.
 */
export function buildCompactionPayload(
  messages: TranscriptMessage[],
  opts: { keepHead: number; keepTail: number },
): CompactionPayload {
  const { keepHead, keepTail } = opts;
  const total = messages.length;

  if (total <= keepHead + keepTail) {
    return { head: messages, tail: [], dropped: [], droppedCount: 0 };
  }

  const head = messages.slice(0, keepHead);
  const tail = messages.slice(total - keepTail);
  const dropped = messages.slice(keepHead, total - keepTail);

  return { head, tail, dropped, droppedCount: dropped.length };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/sessions/__tests__/compaction.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/sessions/compaction.ts src/modules/sessions/__tests__/compaction.test.ts
git commit -m "feat(sessions): add context compaction service with head/tail split"
```

---

## Task 11: 3-Scope Memory + Auto-Extraction

**Files:**
- Create: `src/modules/memory/scoped-memory.ts`
- Create: `src/modules/memory/auto-extract.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/memory/__tests__/scoped-memory.test.ts
import { describe, it, expect } from 'bun:test';
import { ScopedMemoryStore } from '../scoped-memory';

describe('ScopedMemoryStore', () => {
  it('stores and retrieves user-scoped memory', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'user', userId: 'u1', type: 'feedback', name: 'pref', body: 'prefers short answers' });
    const results = store.recall({ scope: 'user', userId: 'u1' });
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe('prefers short answers');
  });

  it('workspace scope is isolated per workspace', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'workspace', workspaceId: 'ws1', type: 'project', name: 'context', body: 'team uses React' });
    store.save({ scope: 'workspace', workspaceId: 'ws2', type: 'project', name: 'context', body: 'team uses Vue' });
    expect(store.recall({ scope: 'workspace', workspaceId: 'ws1' })[0].body).toBe('team uses React');
    expect(store.recall({ scope: 'workspace', workspaceId: 'ws2' })[0].body).toBe('team uses Vue');
  });

  it('global scope visible to all', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'global', type: 'reference', name: 'api-docs', body: 'https://docs.example.com' });
    expect(store.recall({ scope: 'global' })).toHaveLength(1);
  });

  it('forgets by name+scope', () => {
    const store = new ScopedMemoryStore();
    store.save({ scope: 'user', userId: 'u1', type: 'feedback', name: 'pref', body: 'original' });
    store.forget({ scope: 'user', userId: 'u1', name: 'pref' });
    expect(store.recall({ scope: 'user', userId: 'u1' })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/modules/memory/__tests__/scoped-memory.test.ts
```

- [ ] **Step 3: Implement scoped-memory.ts**

```typescript
// src/modules/memory/scoped-memory.ts

export type MemoryScope = 'user' | 'workspace' | 'global';
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  type: MemoryType;
  name: string;
  body: string;
  createdAt: number;
  // Scope keys
  userId?: string;
  workspaceId?: string;
}

export interface SaveMemoryInput {
  scope: MemoryScope;
  type: MemoryType;
  name: string;
  body: string;
  userId?: string;
  workspaceId?: string;
}

export interface RecallFilter {
  scope: MemoryScope;
  userId?: string;
  workspaceId?: string;
  type?: MemoryType;
}

export interface ForgetFilter {
  scope: MemoryScope;
  name: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * In-memory scoped memory store.
 * In production, back this with a DB table (see memory module's existing Drizzle schema).
 *
 * Three scopes:
 *   user      — personal memories, visible only to that user across all workspaces
 *   workspace — shared memories for a workspace team
 *   global    — platform-wide facts (registered at startup)
 */
export class ScopedMemoryStore {
  private entries: MemoryEntry[] = [];

  save(input: SaveMemoryInput): string {
    const id = Math.random().toString(36).slice(2);
    this.entries.push({ ...input, id, createdAt: Date.now() });
    return id;
  }

  recall(filter: RecallFilter): MemoryEntry[] {
    return this.entries.filter(e => {
      if (e.scope !== filter.scope) return false;
      if (filter.type && e.type !== filter.type) return false;
      if (filter.scope === 'user' && e.userId !== filter.userId) return false;
      if (filter.scope === 'workspace' && e.workspaceId !== filter.workspaceId) return false;
      return true;
    });
  }

  forget(filter: ForgetFilter): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => {
      if (e.scope !== filter.scope || e.name !== filter.name) return true;
      if (filter.scope === 'user' && e.userId !== filter.userId) return true;
      if (filter.scope === 'workspace' && e.workspaceId !== filter.workspaceId) return true;
      return false;
    });
    return this.entries.length < before;
  }
}
```

- [ ] **Step 4: Implement auto-extract.ts**

```typescript
// src/modules/memory/auto-extract.ts
import type { TranscriptMessage } from '../sessions/transcript-chain';

export type ExtractedMemoryType = 'feedback' | 'project' | 'reference' | 'user';

export interface ExtractedMemory {
  type: ExtractedMemoryType;
  name: string;
  body: string;
  confidence: 'high' | 'medium';
}

/**
 * Heuristic-based memory extraction from a conversation turn.
 * In production, replace with a lightweight LLM call (Haiku/Flash)
 * that reads the last N messages and extracts memorable facts.
 *
 * This stub extracts based on signal phrases — sufficient for testing
 * and as a fallback when LLM extraction is disabled.
 */
export function extractMemories(messages: TranscriptMessage[]): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];

  for (const msg of messages) {
    const text = msg.content.toLowerCase();

    // Feedback signals
    if (text.includes("don't") || text.includes('stop') || text.includes('never')) {
      memories.push({ type: 'feedback', name: `feedback_${Date.now()}`, body: msg.content, confidence: 'medium' });
    }

    // Reference signals
    if (text.includes('https://') || text.includes('http://')) {
      const urlMatch = msg.content.match(/https?:\/\/\S+/);
      if (urlMatch) {
        memories.push({ type: 'reference', name: `ref_${Date.now()}`, body: urlMatch[0], confidence: 'high' });
      }
    }
  }

  return memories;
}
```

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test src/modules/memory/__tests__/scoped-memory.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/scoped-memory.ts src/modules/memory/auto-extract.ts src/modules/memory/__tests__/scoped-memory.test.ts
git commit -m "feat(memory): add 3-scope memory store + heuristic auto-extraction"
```

---

## Task 12: SSE Sequence Numbers + Client Resumption

**Files:**
- Create: `src/infra/realtime/sse-sequence.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/infra/realtime/__tests__/sse-sequence.test.ts
import { describe, it, expect } from 'bun:test';
import { SequencedEventBuffer } from '../sse-sequence';

describe('SequencedEventBuffer', () => {
  it('assigns incrementing sequence numbers', () => {
    const buf = new SequencedEventBuffer('task-1');
    const e1 = buf.push({ type: 'text_delta', data: { text: 'hello' } });
    const e2 = buf.push({ type: 'text_delta', data: { text: 'world' } });
    expect(e1.sequenceNum).toBe(1);
    expect(e2.sequenceNum).toBe(2);
  });

  it('catchUp returns events after given sequence', () => {
    const buf = new SequencedEventBuffer('task-1');
    buf.push({ type: 'text_delta', data: { text: 'a' } }); // seq 1
    buf.push({ type: 'text_delta', data: { text: 'b' } }); // seq 2
    buf.push({ type: 'text_delta', data: { text: 'c' } }); // seq 3

    const missed = buf.catchUp(1);
    expect(missed).toHaveLength(2);
    expect(missed[0].sequenceNum).toBe(2);
  });

  it('catchUp from 0 returns all events', () => {
    const buf = new SequencedEventBuffer('task-1');
    buf.push({ type: 'done', data: {} });
    buf.push({ type: 'done', data: {} });
    expect(buf.catchUp(0)).toHaveLength(2);
  });

  it('deduplicates by sequenceNum', () => {
    const buf = new SequencedEventBuffer('task-1');
    const e = buf.push({ type: 'text_delta', data: { text: 'x' } });
    expect(buf.catchUp(e.sequenceNum - 1)).toHaveLength(1);
    expect(buf.catchUp(e.sequenceNum)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/infra/realtime/__tests__/sse-sequence.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/infra/realtime/sse-sequence.ts
import type { StreamEvent } from '../ai/types';

export interface SequencedEvent {
  sequenceNum: number;
  taskId: string;
  event: StreamEvent;
  timestamp: number;
}

/**
 * Buffer that assigns monotonically increasing sequence numbers to stream events.
 * Clients reconnecting with ?from_sequence_num=N receive only missed events.
 *
 * Usage:
 *   const buf = new SequencedEventBuffer(taskId);
 *   const seqEvent = buf.push(streamEvent);
 *   // Send seqEvent to clients: `id: ${seqEvent.sequenceNum}\ndata: ${JSON.stringify(seqEvent)}\n\n`
 *   // On reconnect: client sends Last-Event-ID header or from_sequence_num param
 *   // Server calls: buf.catchUp(lastSeenSequenceNum)
 */
export class SequencedEventBuffer {
  private events: SequencedEvent[] = [];
  private counter = 0;
  readonly taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  push(event: StreamEvent): SequencedEvent {
    const sequencedEvent: SequencedEvent = {
      sequenceNum: ++this.counter,
      taskId: this.taskId,
      event,
      timestamp: Date.now(),
    };
    this.events.push(sequencedEvent);
    return sequencedEvent;
  }

  /**
   * Returns all events with sequenceNum > lastSeenSequenceNum.
   * Client passes 0 to get all events from the beginning.
   */
  catchUp(lastSeenSequenceNum: number): SequencedEvent[] {
    return this.events.filter(e => e.sequenceNum > lastSeenSequenceNum);
  }

  get length(): number { return this.events.length; }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/infra/realtime/__tests__/sse-sequence.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/infra/realtime/sse-sequence.ts src/infra/realtime/__tests__/sse-sequence.test.ts
git commit -m "feat(realtime): add SequencedEventBuffer for SSE resumption"
```

---

## Task 13: Batch Event Uploader

**Files:**
- Create: `src/infra/webhooks/batch-uploader.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/infra/webhooks/__tests__/batch-uploader.test.ts
import { describe, it, expect } from 'bun:test';
import { BatchEventUploader } from '../batch-uploader';

describe('BatchEventUploader', () => {
  it('calls flush handler with batched events', async () => {
    const batches: unknown[][] = [];
    const uploader = new BatchEventUploader({
      maxBatchSize: 3,
      flushIntervalMs: 50,
      async flush(events) { batches.push(events); },
    });

    uploader.enqueue({ type: 'a' });
    uploader.enqueue({ type: 'b' });
    uploader.enqueue({ type: 'c' });

    await new Promise(r => setTimeout(r, 100));
    await uploader.drain();

    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.flat()).toHaveLength(3);
    uploader.stop();
  });

  it('respects maxBatchSize by splitting into multiple batches', async () => {
    const batches: unknown[][] = [];
    const uploader = new BatchEventUploader({
      maxBatchSize: 2,
      flushIntervalMs: 10,
      async flush(events) { batches.push([...events]); },
    });

    for (let i = 0; i < 5; i++) uploader.enqueue({ i });
    await new Promise(r => setTimeout(r, 100));
    await uploader.drain();

    const totalItems = batches.flat().length;
    expect(totalItems).toBe(5);
    expect(batches.every(b => b.length <= 2)).toBe(true);
    uploader.stop();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/infra/webhooks/__tests__/batch-uploader.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/infra/webhooks/batch-uploader.ts
import { logger } from '../../config/logger';

export interface BatchUploaderConfig<T> {
  /** Max events per batch. Default: 100. */
  maxBatchSize?: number;
  /** How often to flush even if batch isn't full, in ms. Default: 1000. */
  flushIntervalMs?: number;
  /** Called with each batch. Must be idempotent — may be retried on failure. */
  flush(events: T[]): Promise<void>;
  /** Max consecutive failures before dropping a batch. Default: 5. */
  maxConsecutiveFailures?: number;
}

/**
 * Ordered, batched event uploader with backpressure.
 *
 * Guarantees:
 *   - Events are flushed in enqueue order (serial — at most 1 in-flight POST)
 *   - Batches by count (maxBatchSize) and time interval (flushIntervalMs)
 *   - drain() blocks until queue is empty
 */
export class BatchEventUploader<T = unknown> {
  private queue: T[] = [];
  private flushing = false;
  private consecutiveFailures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private drainWaiters: Array<() => void> = [];

  private readonly maxBatchSize: number;
  private readonly maxConsecutiveFailures: number;
  private readonly flushFn: (events: T[]) => Promise<void>;

  constructor(config: BatchUploaderConfig<T>) {
    this.maxBatchSize = config.maxBatchSize ?? 100;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures ?? 5;
    this.flushFn = config.flush;

    const interval = config.flushIntervalMs ?? 1000;
    this.timer = setInterval(() => this.tryFlush(), interval);
  }

  enqueue(event: T): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) this.tryFlush();
  }

  private async tryFlush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.maxBatchSize);
        try {
          await this.flushFn(batch);
          this.consecutiveFailures = 0;
        } catch (error) {
          this.consecutiveFailures++;
          logger.error({ error, batchSize: batch.length, consecutiveFailures: this.consecutiveFailures }, 'Batch flush failed');
          if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            logger.warn({ dropped: batch.length }, 'Dropping batch after max consecutive failures');
            this.consecutiveFailures = 0;
          } else {
            // Put batch back at front of queue and stop flushing
            this.queue.unshift(...batch);
            break;
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length === 0) {
        this.drainWaiters.forEach(resolve => resolve());
        this.drainWaiters = [];
      }
    }
  }

  /** Wait until all queued events have been flushed. */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.flushing) return;
    await new Promise<void>(resolve => this.drainWaiters.push(resolve));
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/infra/webhooks/__tests__/batch-uploader.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/infra/webhooks/batch-uploader.ts src/infra/webhooks/__tests__/batch-uploader.test.ts
git commit -m "feat(infra): add BatchEventUploader with backpressure and serial delivery"
```

---

## Task 14: Coordinator Mode

**Files:**
- Create: `src/modules/orchestration/coordinator.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/orchestration/__tests__/coordinator.test.ts
import { describe, it, expect } from 'bun:test';
import { Coordinator, type CoordinatorPhase } from '../coordinator';

describe('Coordinator', () => {
  it('starts in research phase', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    expect(coord.currentPhase()).toBe('research');
  });

  it('advances through phases in order', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    const phases: CoordinatorPhase[] = [];
    while (coord.currentPhase() !== 'done') {
      phases.push(coord.currentPhase());
      coord.advance();
    }
    expect(phases).toEqual(['research', 'plan', 'implement', 'verify']);
  });

  it('cannot advance past done', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    ['research', 'plan', 'implement', 'verify', 'done'].forEach(() => coord.advance());
    expect(coord.currentPhase()).toBe('done');
  });

  it('records worker results per phase', () => {
    const coord = new Coordinator({ orchestrationId: 'orch-1' });
    coord.recordWorkerResult('w1', { found: 'data' });
    coord.recordWorkerResult('w2', { found: 'more data' });
    expect(coord.phaseResults('research')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/modules/orchestration/__tests__/coordinator.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/modules/orchestration/coordinator.ts

export type CoordinatorPhase = 'research' | 'plan' | 'implement' | 'verify' | 'done';

const PHASE_ORDER: CoordinatorPhase[] = ['research', 'plan', 'implement', 'verify', 'done'];

export interface WorkerResult {
  workerId: string;
  phase: CoordinatorPhase;
  result: unknown;
  completedAt: number;
}

export interface CoordinatorConfig {
  orchestrationId: string;
}

/**
 * Coordinator Mode — phase-based multi-agent orchestration.
 *
 * Phases:
 *   research   — parallel read-only workers gather information
 *   plan       — coordinator synthesizes findings, creates implementation plan
 *   implement  — serial workers execute plan steps
 *   verify     — adversarial verification workers check output
 *   done       — all phases complete
 *
 * Key constraint: the coordinator NEVER delegates synthesis.
 * It reads all worker results and forms its own understanding
 * before directing the next phase.
 */
export class Coordinator {
  readonly orchestrationId: string;
  private phase: CoordinatorPhase = 'research';
  private results: WorkerResult[] = [];

  constructor(config: CoordinatorConfig) {
    this.orchestrationId = config.orchestrationId;
  }

  currentPhase(): CoordinatorPhase {
    return this.phase;
  }

  advance(): void {
    const idx = PHASE_ORDER.indexOf(this.phase);
    if (idx < PHASE_ORDER.length - 1) {
      this.phase = PHASE_ORDER[idx + 1];
    }
  }

  recordWorkerResult(workerId: string, result: unknown): void {
    this.results.push({ workerId, phase: this.phase, result, completedAt: Date.now() });
  }

  phaseResults(phase: CoordinatorPhase): WorkerResult[] {
    return this.results.filter(r => r.phase === phase);
  }

  allResults(): WorkerResult[] {
    return [...this.results];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/orchestration/__tests__/coordinator.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/orchestration/coordinator.ts src/modules/orchestration/__tests__/coordinator.test.ts
git commit -m "feat(orchestration): add Coordinator with research→plan→implement→verify phases"
```

---

## Task 15: Verification Agent (Built-in Adversarial QA)

**Files:**
- Create: `src/modules/agents/verification-agent.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/agents/__tests__/verification-agent.test.ts
import { describe, it, expect } from 'bun:test';
import { buildVerificationPrompt, parseVerificationVerdict, type VerificationVerdict } from '../verification-agent';

describe('VerificationAgent', () => {
  it('builds a prompt with task, changes, and approach', () => {
    const prompt = buildVerificationPrompt({
      originalTask: 'Add user authentication',
      filesChanged: ['src/auth/handler.ts', 'src/auth/middleware.ts'],
      approach: 'JWT-based with refresh tokens',
    });
    expect(prompt).toContain('Add user authentication');
    expect(prompt).toContain('src/auth/handler.ts');
    expect(prompt).toContain('adversarial');
  });

  it('parses PASS verdict', () => {
    const output = 'The implementation looks correct.\n\nVERDICT: PASS\nAll checks passed.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('PASS');
  });

  it('parses FAIL verdict', () => {
    const output = 'Found a bug in the auth flow.\n\nVERDICT: FAIL\nMissing token expiry check.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('FAIL');
    expect(verdict.detail).toContain('Missing token expiry');
  });

  it('parses PARTIAL verdict', () => {
    const output = 'Mostly correct but edge cases missing.\n\nVERDICT: PARTIAL\nMissing null check on line 42.';
    const verdict = parseVerificationVerdict(output);
    expect(verdict.outcome).toBe('PARTIAL');
  });

  it('returns UNKNOWN when no verdict found', () => {
    const verdict = parseVerificationVerdict('No verdict mentioned here.');
    expect(verdict.outcome).toBe('UNKNOWN');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/modules/agents/__tests__/verification-agent.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/modules/agents/verification-agent.ts

export type VerificationOutcome = 'PASS' | 'FAIL' | 'PARTIAL' | 'UNKNOWN';

export interface VerificationVerdict {
  outcome: VerificationOutcome;
  detail: string;
  rawOutput: string;
}

export interface VerificationInput {
  originalTask: string;
  filesChanged: string[];
  approach: string;
  additionalContext?: string;
}

/**
 * Builds the system prompt for the adversarial verification agent.
 *
 * The verification agent tries to BREAK the implementation, not confirm it.
 * It must run real commands and observe actual output — no assumptions.
 * It always ends with a structured VERDICT: PASS | FAIL | PARTIAL line.
 */
export function buildVerificationPrompt(input: VerificationInput): string {
  return `You are an adversarial verification agent. Your job is to BREAK this implementation, not confirm it.

## Original Task
${input.originalTask}

## Files Changed
${input.filesChanged.map(f => `- ${f}`).join('\n')}

## Approach Taken
${input.approach}
${input.additionalContext ? `\n## Additional Context\n${input.additionalContext}` : ''}

## Your Verification Protocol

1. **Read every changed file** — understand what was implemented
2. **Run the actual code** — no assumptions about what it does
3. **Probe adversarially** — try these attack vectors:
   - Boundary values (empty input, null, max length, negative numbers)
   - Concurrent calls (what happens if called twice simultaneously?)
   - Idempotency (does running it twice break state?)
   - Error paths (what if a dependency fails mid-execution?)
   - Orphan operations (are there side effects that aren't cleaned up?)
4. **Check every requirement** from the original task — not just the happy path

## Output Format

Write your findings, then end with exactly:

VERDICT: PASS
(or VERDICT: FAIL, or VERDICT: PARTIAL)

Followed by a one-sentence summary of the most important finding.`;
}

/**
 * Parses the structured VERDICT line from verification agent output.
 */
export function parseVerificationVerdict(output: string): VerificationVerdict {
  const match = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)\s*\n?(.+)?/i);
  if (!match) {
    return { outcome: 'UNKNOWN', detail: 'No verdict found in output', rawOutput: output };
  }
  const outcome = match[1].toUpperCase() as VerificationOutcome;
  const detail = (match[2] ?? '').trim();
  return { outcome, detail, rawOutput: output };
}

/**
 * Definition for registering the verification agent in the agent registry.
 * Plug this into your AgentDefinitionRegistry at startup.
 */
export const VERIFICATION_AGENT_DEFINITION = {
  agentType: 'verification',
  whenToUse: 'After implementing any feature, bug fix, or refactor — to adversarially verify correctness before marking complete.',
  isReadOnly: true, // verification agents do not write production code
  allowedTools: ['Bash', 'Read', 'Glob', 'Grep'], // no write tools
  model: 'claude-sonnet-4-6',
  buildSystemPrompt: buildVerificationPrompt,
} as const;
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/agents/__tests__/verification-agent.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/verification-agent.ts src/modules/agents/__tests__/verification-agent.test.ts
git commit -m "feat(agents): add adversarial VerificationAgent with VERDICT protocol"
```

---

## Task 16: env.ts — Add Missing Infrastructure Env Vars

**Files:**
- Modify: `src/config/env.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/config/__tests__/env.test.ts
import { describe, it, expect } from 'bun:test';
import { envSchema } from '../env';

describe('env schema', () => {
  it('accepts minimal valid config', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgres://localhost/test',
      CLERK_SECRET_KEY: 'sk_test_abc',
    });
    expect(result.success).toBe(true);
  });

  it('has correct defaults', () => {
    const result = envSchema.parse({ DATABASE_URL: 'postgres://x', CLERK_SECRET_KEY: 'sk' });
    expect(result.PORT).toBe(3001);
    expect(result.NODE_ENV).toBe('development');
    expect(result.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.AI_DEFAULT_PROVIDER).toBe('anthropic');
    expect(result.AI_FALLBACK_ENABLED).toBe(true);
    expect(result.INTENT_GATE_ENABLED).toBe(true);
    expect(result.SSE_SEQUENCE_ENABLED).toBe(true);
    expect(result.MEMORY_AUTO_EXTRACT).toBe(false);
    expect(result.COMPACTION_MAX_MESSAGES).toBe(100);
    expect(result.COMPACTION_TOKEN_BUDGET).toBe(150000);
  });

  it('rejects invalid NODE_ENV', () => {
    const result = envSchema.safeParse({ DATABASE_URL: 'x', CLERK_SECRET_KEY: 'x', NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd backend && bun test src/config/__tests__/env.test.ts
```

- [ ] **Step 3: Update env.ts**

```typescript
// src/config/env.ts
import { z } from 'zod';

export const envSchema = z.object({
  // ── Core ────────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL: z.string(),

  // ── Redis ───────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ── Auth ────────────────────────────────────────────────────────────────────
  CLERK_SECRET_KEY: z.string(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // ── AI Providers ────────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  /** Primary AI provider used when no explicit provider is requested. */
  AI_DEFAULT_PROVIDER: z.enum(['anthropic', 'openai', 'google']).default('anthropic'),
  /** When true, failed AI calls fall through to the next provider in the chain. */
  AI_FALLBACK_ENABLED: z.coerce.boolean().default(true),

  // ── AI Model Overrides (optional — overrides ModelRouter defaults) ───────────
  MODEL_OVERRIDE_LOOKUP: z.string().optional(),
  MODEL_OVERRIDE_ANALYSIS: z.string().optional(),
  MODEL_OVERRIDE_GENERATION: z.string().optional(),
  MODEL_OVERRIDE_DEEP: z.string().optional(),

  // ── Feature Flags (runtime-configurable) ────────────────────────────────────
  /** Enable Intent Gate to route prompts to cheapest capable model. */
  INTENT_GATE_ENABLED: z.coerce.boolean().default(true),
  /** Enable SSE sequence numbers for resumable streams. */
  SSE_SEQUENCE_ENABLED: z.coerce.boolean().default(true),
  /** Enable automatic memory extraction after each agent turn. */
  MEMORY_AUTO_EXTRACT: z.coerce.boolean().default(false),

  // ── Session Compaction ───────────────────────────────────────────────────────
  /** Trigger compaction when session exceeds this many messages. */
  COMPACTION_MAX_MESSAGES: z.coerce.number().default(100),
  /** Trigger compaction when estimated token usage exceeds this. */
  COMPACTION_TOKEN_BUDGET: z.coerce.number().default(150_000),

  // ── External Services ────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOVU_API_KEY: z.string().optional(),

  // ── Observability ────────────────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('supplymind-backend'),

  // ── HTTP ────────────────────────────────────────────────────────────────────
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/config/__tests__/env.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/__tests__/env.test.ts
git commit -m "feat(config): expand env schema with AI routing, compaction, and feature flag vars"
```

---

## Task 17: Clean Domain Events Directory

**Files:**
- Modify: `src/events/domain/types.ts`
- Modify: `src/events/domain/emitter.ts`
- Delete strategies that are supply-chain specific (if any exist)

- [ ] **Step 1: Read current domain types**

```bash
cat src/events/domain/types.ts
```

- [ ] **Step 2: Replace with generic entity types**

Replace the content of `src/events/domain/types.ts` with:

```typescript
// src/events/domain/types.ts

/**
 * Generic domain event system.
 * Domain-specific entities (e.g., "Invoice", "Product", "Ticket") are registered
 * at runtime by plugging in a DomainEventStrategy for each entity type.
 * No domain-specific entity types live here.
 */

export interface DomainEvent<TPayload = unknown> {
  id: string;
  entityType: string;   // e.g., 'invoice', 'product' — registered by domain modules
  entityId: string;
  action: string;       // e.g., 'created', 'updated', 'deleted', 'status_changed'
  payload: TPayload;
  workspaceId: string;
  occurredAt: number;
}

export interface StrategyContext {
  workspaceId: string;
  callerId: string;
}

/**
 * Implement this interface to handle domain events for a specific entity type.
 * Register via registerStrategy(entityType, strategy) at module startup.
 */
export interface DomainEventStrategy<TEntity = unknown> {
  /** Entity type this strategy handles (e.g., 'invoice'). */
  entityType: string;
  /**
   * Evaluate an entity and emit appropriate domain events.
   * Called after any create/update operation on this entity type.
   */
  evaluate(entity: TEntity, ctx: StrategyContext): Promise<DomainEvent[]>;
}
```

- [ ] **Step 3: Verify emitter.ts is already generic**

Read `src/events/domain/emitter.ts` — if it references supply-chain specific entities (supplier, material, order, logistics, forecast), remove those references and keep only the generic `emitDomainEvents`, `emitDomainEventsBatch`, `registerStrategy` functions.

- [ ] **Step 4: Delete supply-chain specific strategy files**

```bash
ls src/events/domain/strategies/
# Delete any files that are supply-chain specific (e.g., supplier.ts, order.ts, forecast.ts)
# Keep only the strategies/ directory itself
```

- [ ] **Step 5: Run full test suite to verify nothing broke**

```bash
cd backend && bun test
```

- [ ] **Step 6: Commit**

```bash
git add src/events/domain/
git commit -m "refactor(events): make domain event system fully generic — no domain-specific entity types"
```

---

## Final Validation

- [ ] **Run full test suite**

```bash
cd backend && bun test
```
Expected: All tasks' tests pass. Zero domain-specific references in `src/core/`, `src/infra/`, `src/events/domain/`.

- [ ] **Verify no domain-specific imports in base layer**

```bash
grep -r "supplier\|supply.chain\|invoice\|product\|order\|logistics\|forecast" src/core/ src/infra/ src/events/domain/ --include="*.ts"
```
Expected: No results.

- [ ] **Type-check**

```bash
cd backend && bun run build
```
Expected: No TypeScript errors.

- [ ] **Final commit**

```bash
git add .
git commit -m "feat: complete generic backend base foundation — 17 tasks, 0 domain-specific code"
```

---

## What This Unlocks

Once this plan is complete, domain modules plug in via:

| Extension Point | How Domains Plug In |
|---|---|
| `buildTool()` | Register domain tools with correct safety flags |
| `permissionPipeline.addLayer()` | Domain-specific permission rules |
| `lifecycleHooks.register()` | Domain webhooks on tool/task events |
| `toolSearchRegistry.register()` | Deferred domain-specific tools |
| `registerStrategy(entityType, strategy)` | Domain entity event handlers |
| `routeModel(tier, provider)` | Override model selection per domain |
| `ScopedMemoryStore` | Domain facts stored in user/workspace scope |
| `Coordinator` phases | Domain-specific research/implement/verify workers |
