# Advanced Multi-Provider Tool Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Anthropic's advanced tool-use patterns (strict mode, tool choice, prompt caching, fine-grained streaming, server tools, tool search, programmatic calling) into the multi-provider architecture so skills/tools/MCP/plugins work uniformly across Anthropic, OpenAI, and Google providers.

**Architecture:** Extend the shared `ToolDefinition` and `RunInput` types with provider-agnostic options that each runtime adapter consumes. Provider-specific features (strict, cacheControl, serverTools) degrade gracefully — adapters pick up what they support and ignore the rest. The skill registry and tool-format layer handle conversion transparently. A new `runtime-factory.ts` extracts factory logic from task-manager.

**Tech Stack:** Bun + bun:test, Anthropic SDK, OpenAI SDK, @google/genai, Hono, custom EventBus (wildcard topics, dead letters, replay)

---

## File Structure

All paths relative to `backend/src/`.

```
infra/ai/
  types.ts                    (M)  Extend ToolDefinition, RunInput, RunResult, StreamEvent, add ToolChoice
  tool-format.ts              (M)  Pass through strict, cacheControl, eagerInputStreaming per provider
  runtime-factory.ts          (N)  Extract createRuntime() from task-manager
  anthropic.ts                (M)  Support toolChoice, strict, cacheControl, eagerInputStreaming, pause_turn
  openai.ts                   (M)  Support toolChoice, strict (via function.strict), parallel tool use
  google.ts                   (M)  Support toolChoice (toolConfig)
  anthropic-agent-sdk.ts      (M)  Support toolChoice, pass through to SDK
  openai-agents.ts            (M)  Support toolChoice, pass through to SDK

infra/a2a/
  types.ts                    (M)  Extend AgentCard with provider capabilities, tool metadata
  agent-card.ts               (M)  Include tool metadata (inputSchema) and provider capabilities
  task-manager.ts             (M)  Use runtime-factory, support toolChoice, parallel tool exec, is_error

modules/skills/
  skills.types.ts             (M)  Extend Skill with metadata (strict, cacheable, eagerStream)
  skills.registry.ts          (M)  Extend toToolDefinitions() to pass through metadata
```

**Test files (all new):**

```
infra/ai/__tests__/runtime-factory.test.ts
infra/ai/__tests__/tool-format.test.ts
infra/ai/__tests__/anthropic.test.ts     (extend existing if present)
infra/a2a/__tests__/agent-card.test.ts   (extend existing if present)
```

---

## Task 1: Extend ToolDefinition and RunInput types

**Files:**
- Modify: `src/infra/ai/types.ts`

- [ ] **Step 1: Add ToolChoice type and extend ToolDefinition**

```typescript
// Add after existing ToolDefinition interface — replace the entire types.ts

export type AgentMode = "raw" | "agent-sdk";
export type AIProvider = "anthropic" | "openai" | "google";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  content?: string;
  isError?: boolean; // NEW: marks a tool result as an error
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // --- Provider hints (adapters use what they support, ignore the rest) ---
  strict?: boolean;              // Anthropic/OpenAI: grammar-constrained JSON Schema
  cacheControl?: { type: 'ephemeral' }; // Anthropic: prompt caching on tool defs
  eagerInputStreaming?: boolean; // Anthropic: fine-grained tool streaming
  deferLoading?: boolean;       // Anthropic: tool search deferred loading
}

/** Controls which tool the model must/can use */
export type ToolChoice =
  | { type: 'auto' }                     // model decides (default)
  | { type: 'any' }                      // must use SOME tool
  | { type: 'tool'; name: string }       // must use THIS specific tool
  | { type: 'none' };                    // no tool use allowed

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface RunInput {
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  // --- New options ---
  toolChoice?: ToolChoice;
  disableParallelToolUse?: boolean; // Anthropic: force sequential tool calls
}

export interface RunResult {
  content: string;
  toolCalls?: ToolCallRequest[];
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "pause_turn";
}

export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done" | "error";
  data: unknown;
}

export interface AgentRuntime {
  run(input: RunInput): Promise<Result<RunResult>>;
  stream(input: RunInput): AsyncIterable<StreamEvent>;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bun test`
Expected: 151 tests pass (no behavioral change — only additive type changes)

- [ ] **Step 3: Commit**

```bash
git add src/infra/ai/types.ts
git commit -m "feat(ai): extend ToolDefinition and RunInput with toolChoice, strict, caching, streaming options"
```

---

## Task 2: Extend Skill type with tool metadata

**Files:**
- Modify: `src/modules/skills/skills.types.ts`
- Modify: `src/modules/skills/skills.registry.ts`

- [ ] **Step 1: Add metadata to Skill interface**

In `src/modules/skills/skills.types.ts`, add optional metadata to Skill:

```typescript
export type SkillProviderType = "builtin" | "worker" | "plugin" | "mcp" | "inline";

/** Optional hints that flow through to ToolDefinition when skills are converted to tools */
export interface SkillToolHints {
  strict?: boolean;             // Enable strict JSON Schema validation
  cacheable?: boolean;          // Mark tool definition as cacheable (prompt caching)
  eagerInputStreaming?: boolean; // Enable fine-grained tool streaming
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  providerType: SkillProviderType;
  priority: number;
  handler: (args: unknown) => Promise<Result<unknown>>;
  toolHints?: SkillToolHints; // NEW
}

export interface SkillProvider {
  type: SkillProviderType;
  priority: number;
  loadSkills(): Promise<Skill[]>;
}

export interface DispatchContext {
  callerId: string;
  workspaceId: string;
  callerRole: string;
  traceId?: string;
}

export type DispatchFn = (
  skillId: string,
  args: Record<string, unknown>,
  context: DispatchContext,
) => Promise<Result<unknown>>;
```

- [ ] **Step 2: Update toToolDefinitions() in skills.registry.ts to pass through hints**

In `src/modules/skills/skills.registry.ts`, modify `toToolDefinitions()`:

```typescript
toToolDefinitions(): ToolDefinition[] {
  return this.list().map(s => ({
    name: s.name,
    description: s.description,
    inputSchema: s.inputSchema,
    ...(s.toolHints?.strict !== undefined && { strict: s.toolHints.strict }),
    ...(s.toolHints?.cacheable && { cacheControl: { type: 'ephemeral' as const } }),
    ...(s.toolHints?.eagerInputStreaming !== undefined && { eagerInputStreaming: s.toolHints.eagerInputStreaming }),
  }));
}
```

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: All pass (additive changes only)

- [ ] **Step 4: Commit**

```bash
git add src/modules/skills/skills.types.ts src/modules/skills/skills.registry.ts
git commit -m "feat(skills): add toolHints to Skill type, flow through to ToolDefinition"
```

---

## Task 3: Extend tool-format.ts for provider-specific options

**Files:**
- Modify: `src/infra/ai/tool-format.ts`
- Create: `src/infra/ai/__tests__/tool-format.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/infra/ai/__tests__/tool-format.test.ts
import { describe, test, expect } from 'bun:test';
import { toAnthropicTools, toOpenAITools, toGoogleTools } from '../tool-format';
import type { ToolDefinition } from '../types';

const baseTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get weather',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

describe('toAnthropicTools', () => {
  test('maps basic tool definition', () => {
    const result = toAnthropicTools([baseTool]);
    expect(result).toEqual([{
      name: 'get_weather',
      description: 'Get weather',
      input_schema: baseTool.inputSchema,
    }]);
  });

  test('passes through strict flag', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true };
    const result = toAnthropicTools([tool]);
    expect(result[0].strict).toBe(true);
  });

  test('omits strict when not set', () => {
    const result = toAnthropicTools([baseTool]);
    expect(result[0]).not.toHaveProperty('strict');
  });

  test('passes through cache_control', () => {
    const tool: ToolDefinition = { ...baseTool, cacheControl: { type: 'ephemeral' } };
    const result = toAnthropicTools([tool]);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('passes through eager_input_streaming', () => {
    const tool: ToolDefinition = { ...baseTool, eagerInputStreaming: true };
    const result = toAnthropicTools([tool]);
    expect(result[0].eager_input_streaming).toBe(true);
  });
});

describe('toOpenAITools', () => {
  test('maps basic tool definition', () => {
    const result = toOpenAITools([baseTool]);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('get_weather');
    expect(result[0].function.parameters).toEqual(baseTool.inputSchema);
  });

  test('passes through strict flag', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true };
    const result = toOpenAITools([tool]);
    expect(result[0].function.strict).toBe(true);
  });

  test('omits strict when not set', () => {
    const result = toOpenAITools([baseTool]);
    expect(result[0].function).not.toHaveProperty('strict');
  });
});

describe('toGoogleTools', () => {
  test('wraps tools in functionDeclarations', () => {
    const result = toGoogleTools([baseTool]);
    expect(result[0].functionDeclarations).toHaveLength(1);
    expect(result[0].functionDeclarations[0].name).toBe('get_weather');
  });

  test('ignores strict/cache/streaming (Google does not support them)', () => {
    const tool: ToolDefinition = { ...baseTool, strict: true, cacheControl: { type: 'ephemeral' }, eagerInputStreaming: true };
    const result = toGoogleTools([tool]);
    const decl = result[0].functionDeclarations[0];
    expect(decl).not.toHaveProperty('strict');
    expect(decl).not.toHaveProperty('cache_control');
    expect(decl).not.toHaveProperty('eager_input_streaming');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/infra/ai/__tests__/tool-format.test.ts`
Expected: FAIL — strict, cache_control, eager_input_streaming not present

- [ ] **Step 3: Implement tool-format.ts with provider-specific pass-through**

```typescript
// src/infra/ai/tool-format.ts
import type { ToolDefinition, ToolChoice } from './types';

export function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const tool: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    };
    if (t.strict !== undefined) tool.strict = t.strict;
    if (t.cacheControl) tool.cache_control = t.cacheControl;
    if (t.eagerInputStreaming !== undefined) tool.eager_input_streaming = t.eagerInputStreaming;
    return tool;
  });
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const fn: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    };
    if (t.strict !== undefined) fn.strict = t.strict;
    return { type: 'function' as const, function: fn };
  });
}

export function toGoogleTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

/** Convert our ToolChoice to Anthropic's tool_choice format */
export function toAnthropicToolChoice(choice: ToolChoice): Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return { type: 'auto' };
    case 'any': return { type: 'any' };
    case 'tool': return { type: 'tool', name: choice.name };
    case 'none': return { type: 'auto' }; // Anthropic has no 'none' — pass empty tools instead
  }
}

/** Convert our ToolChoice to OpenAI's tool_choice format */
export function toOpenAIToolChoice(choice: ToolChoice): string | Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'tool': return { type: 'function', function: { name: choice.name } };
    case 'none': return 'none';
  }
}

/** Convert our ToolChoice to Google's toolConfig format */
export function toGoogleToolConfig(choice: ToolChoice): Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return { functionCallingConfig: { mode: 'AUTO' } };
    case 'any': return { functionCallingConfig: { mode: 'ANY' } };
    case 'tool': return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
    case 'none': return { functionCallingConfig: { mode: 'NONE' } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/infra/ai/__tests__/tool-format.test.ts`
Expected: All pass

- [ ] **Step 5: Write tests for toolChoice converters**

Add to `src/infra/ai/__tests__/tool-format.test.ts`:

```typescript
import { toAnthropicToolChoice, toOpenAIToolChoice, toGoogleToolConfig } from '../tool-format';

describe('toAnthropicToolChoice', () => {
  test('auto', () => {
    expect(toAnthropicToolChoice({ type: 'auto' })).toEqual({ type: 'auto' });
  });
  test('any', () => {
    expect(toAnthropicToolChoice({ type: 'any' })).toEqual({ type: 'any' });
  });
  test('specific tool', () => {
    expect(toAnthropicToolChoice({ type: 'tool', name: 'get_weather' })).toEqual({ type: 'tool', name: 'get_weather' });
  });
  test('none falls back to auto', () => {
    expect(toAnthropicToolChoice({ type: 'none' })).toEqual({ type: 'auto' });
  });
});

describe('toOpenAIToolChoice', () => {
  test('auto', () => {
    expect(toOpenAIToolChoice({ type: 'auto' })).toBe('auto');
  });
  test('any maps to required', () => {
    expect(toOpenAIToolChoice({ type: 'any' })).toBe('required');
  });
  test('specific tool', () => {
    expect(toOpenAIToolChoice({ type: 'tool', name: 'search' })).toEqual({ type: 'function', function: { name: 'search' } });
  });
  test('none', () => {
    expect(toOpenAIToolChoice({ type: 'none' })).toBe('none');
  });
});

describe('toGoogleToolConfig', () => {
  test('auto', () => {
    expect(toGoogleToolConfig({ type: 'auto' })).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });
  test('any', () => {
    expect(toGoogleToolConfig({ type: 'any' })).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });
  test('specific tool', () => {
    expect(toGoogleToolConfig({ type: 'tool', name: 'calc' })).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['calc'] },
    });
  });
  test('none', () => {
    expect(toGoogleToolConfig({ type: 'none' })).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/infra/ai/tool-format.ts src/infra/ai/__tests__/tool-format.test.ts
git commit -m "feat(ai): extend tool-format with strict, caching, streaming, toolChoice per provider"
```

---

## Task 4: Extract runtime-factory.ts from task-manager

**Files:**
- Create: `src/infra/ai/runtime-factory.ts`
- Create: `src/infra/ai/__tests__/runtime-factory.test.ts`
- Modify: `src/infra/a2a/task-manager.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/infra/ai/__tests__/runtime-factory.test.ts
import { describe, test, expect } from 'bun:test';
import { createRuntime } from '../runtime-factory';
import { AnthropicRawRuntime } from '../anthropic';
import { OpenAIRawRuntime } from '../openai';
import { GoogleRawRuntime } from '../google';
import { AnthropicAgentSdkRuntime } from '../anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from '../openai-agents';

describe('createRuntime', () => {
  test('raw + anthropic returns AnthropicRawRuntime', () => {
    const rt = createRuntime('anthropic', 'raw');
    expect(rt).toBeInstanceOf(AnthropicRawRuntime);
  });

  test('raw + openai returns OpenAIRawRuntime', () => {
    const rt = createRuntime('openai', 'raw');
    expect(rt).toBeInstanceOf(OpenAIRawRuntime);
  });

  test('raw + google returns GoogleRawRuntime', () => {
    const rt = createRuntime('google', 'raw');
    expect(rt).toBeInstanceOf(GoogleRawRuntime);
  });

  test('agent-sdk + anthropic returns AnthropicAgentSdkRuntime', () => {
    const rt = createRuntime('anthropic', 'agent-sdk');
    expect(rt).toBeInstanceOf(AnthropicAgentSdkRuntime);
  });

  test('agent-sdk + openai returns OpenAIAgentSdkRuntime', () => {
    const rt = createRuntime('openai', 'agent-sdk');
    expect(rt).toBeInstanceOf(OpenAIAgentSdkRuntime);
  });

  test('agent-sdk + google throws', () => {
    expect(() => createRuntime('google', 'agent-sdk')).toThrow('No agent-sdk runtime');
  });

  test('unknown provider throws', () => {
    expect(() => createRuntime('unknown' as any, 'raw')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/infra/ai/__tests__/runtime-factory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runtime-factory.ts**

```typescript
// src/infra/ai/runtime-factory.ts
import { AnthropicRawRuntime } from './anthropic';
import { OpenAIRawRuntime } from './openai';
import { GoogleRawRuntime } from './google';
import { AnthropicAgentSdkRuntime } from './anthropic-agent-sdk';
import { OpenAIAgentSdkRuntime } from './openai-agents';
import type { AgentRuntime, AIProvider, AgentMode } from './types';

export function createRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
  if (mode === 'agent-sdk') {
    if (provider === 'anthropic') return new AnthropicAgentSdkRuntime();
    if (provider === 'openai') return new OpenAIAgentSdkRuntime();
    throw new Error(`No agent-sdk runtime for provider: ${provider}`);
  }
  if (provider === 'anthropic') return new AnthropicRawRuntime();
  if (provider === 'openai') return new OpenAIRawRuntime();
  if (provider === 'google') return new GoogleRawRuntime();
  throw new Error(`No raw runtime for provider: ${provider}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/infra/ai/__tests__/runtime-factory.test.ts`
Expected: All pass

- [ ] **Step 5: Update task-manager.ts to use createRuntime**

In `src/infra/a2a/task-manager.ts`:
- Remove the 5 direct runtime imports (AnthropicRawRuntime, OpenAIRawRuntime, etc.)
- Import `createRuntime` from `../ai/runtime-factory`
- Replace the `resolveRuntime` method body:

```typescript
private resolveRuntime(provider: AIProvider, mode: AgentMode): AgentRuntime {
  return createRuntime(provider, mode);
}
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/infra/ai/runtime-factory.ts src/infra/ai/__tests__/runtime-factory.test.ts src/infra/a2a/task-manager.ts
git commit -m "refactor(ai): extract runtime-factory from task-manager"
```

---

## Task 5: Add toolChoice support to Anthropic raw runtime

**Files:**
- Modify: `src/infra/ai/anthropic.ts`

- [ ] **Step 1: Import toAnthropicToolChoice and update run()**

In `src/infra/ai/anthropic.ts`, add toolChoice and disableParallelToolUse support to both `run()` and `stream()`:

```typescript
// At top, update import:
import { toAnthropicTools, toAnthropicToolChoice } from './tool-format';

// In run() method, after the tools assignment (line ~46), add:
if (input.toolChoice && input.tools?.length) {
  params.tool_choice = toAnthropicToolChoice(input.toolChoice) as any;
}
if (input.disableParallelToolUse !== undefined) {
  (params as any).tool_choice = {
    ...(params as any).tool_choice ?? { type: 'auto' },
    disable_parallel_tool_use: input.disableParallelToolUse,
  };
}
```

- [ ] **Step 2: Add pause_turn stop reason mapping**

In `run()`, update the stopReason mapping to include `pause_turn`:

```typescript
const stopReason = response.stop_reason === 'end_turn'
  ? 'end_turn'
  : response.stop_reason === 'tool_use'
    ? 'tool_use'
    : response.stop_reason === 'max_tokens'
      ? 'max_tokens'
      : (response.stop_reason as string) === 'pause_turn'
        ? 'pause_turn'
        : 'end_turn';
```

- [ ] **Step 3: Apply same changes to stream() method**

In `stream()`, add after the tools line:

```typescript
if (input.toolChoice && input.tools?.length) {
  (params as any).tool_choice = toAnthropicToolChoice(input.toolChoice);
}
if (input.disableParallelToolUse !== undefined) {
  (params as any).tool_choice = {
    ...(params as any).tool_choice ?? { type: 'auto' },
    disable_parallel_tool_use: input.disableParallelToolUse,
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/infra/ai/anthropic.ts
git commit -m "feat(anthropic): add toolChoice, disableParallelToolUse, pause_turn support"
```

---

## Task 6: Add toolChoice support to OpenAI raw runtime

**Files:**
- Modify: `src/infra/ai/openai.ts`

- [ ] **Step 1: Import toOpenAIToolChoice and update run()**

```typescript
// At top, update import:
import { toOpenAITools, toOpenAIToolChoice } from './tool-format';

// In run(), after tools assignment (line ~58), add:
if (input.toolChoice && input.tools?.length) {
  params.tool_choice = toOpenAIToolChoice(input.toolChoice) as any;
}
if (input.disableParallelToolUse) {
  params.parallel_tool_calls = false;
}
```

- [ ] **Step 2: Apply same changes to stream()**

```typescript
if (input.toolChoice && input.tools?.length) {
  (params as any).tool_choice = toOpenAIToolChoice(input.toolChoice);
}
if (input.disableParallelToolUse) {
  (params as any).parallel_tool_calls = false;
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/infra/ai/openai.ts
git commit -m "feat(openai): add toolChoice and parallel_tool_calls support"
```

---

## Task 7: Add toolChoice support to Google raw runtime

**Files:**
- Modify: `src/infra/ai/google.ts`

- [ ] **Step 1: Import toGoogleToolConfig and update run()**

```typescript
// At top, update import:
import { toGoogleTools, toGoogleToolConfig } from './tool-format';

// In run(), after tools assignment (line ~22), add:
if (input.toolChoice && input.tools?.length) {
  config.toolConfig = toGoogleToolConfig(input.toolChoice);
}
```

- [ ] **Step 2: Apply same to stream()**

```typescript
if (input.toolChoice && input.tools?.length) {
  config.toolConfig = toGoogleToolConfig(input.toolChoice);
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/infra/ai/google.ts
git commit -m "feat(google): add toolChoice support via toolConfig"
```

---

## Task 8: Add toolChoice to agent-sdk runtimes

**Files:**
- Modify: `src/infra/ai/anthropic-agent-sdk.ts`
- Modify: `src/infra/ai/openai-agents.ts`

- [ ] **Step 1: Update AnthropicAgentSdkRuntime**

In `anthropic-agent-sdk.ts`, import and use toolChoice:

```typescript
import { toAnthropicTools, toAnthropicToolChoice } from './tool-format';

// In run(), inside the client.messages.create call, add after tools:
...(input.toolChoice && input.tools?.length ? { tool_choice: toAnthropicToolChoice(input.toolChoice) } : {}),
...(input.disableParallelToolUse !== undefined ? {
  tool_choice: {
    ...(input.toolChoice ? toAnthropicToolChoice(input.toolChoice) : { type: 'auto' }),
    disable_parallel_tool_use: input.disableParallelToolUse,
  }
} : {}),
```

- [ ] **Step 2: Update OpenAIAgentSdkRuntime**

In `openai-agents.ts`, import and use toolChoice:

```typescript
import { toOpenAITools, toOpenAIToolChoice } from './tool-format';

// In run(), add to create params:
...(input.toolChoice && input.tools?.length ? { tool_choice: toOpenAIToolChoice(input.toolChoice) } : {}),
...(input.disableParallelToolUse ? { parallel_tool_calls: false } : {}),
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/infra/ai/anthropic-agent-sdk.ts src/infra/ai/openai-agents.ts
git commit -m "feat(agent-sdk): add toolChoice support to both SDK runtimes"
```

---

## Task 9: Enhance task-manager with toolChoice, is_error, parallel execution

**Files:**
- Modify: `src/infra/a2a/task-manager.ts`

- [ ] **Step 1: Extend agentConfig type with toolChoice and disableParallelToolUse**

In the `send()` method signature, extend the `agentConfig` type:

```typescript
async send(params: TaskSendParams & {
  agentConfig: {
    id: string;
    provider: AIProvider;
    mode: 'raw' | 'agent-sdk';
    model: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    toolIds?: string[];
    workspaceId: string;
    toolChoice?: ToolChoice;                // NEW
    disableParallelToolUse?: boolean;       // NEW
  };
  callerId: string;
}): Promise<A2ATask> {
```

- [ ] **Step 2: Pass toolChoice through to RunInput in executeTask**

In `executeTask()`, update the input construction:

```typescript
const input: RunInput = {
  messages,
  systemPrompt: config.systemPrompt,
  tools,
  model: config.model,
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  toolChoice: config.toolChoice,
  disableParallelToolUse: config.disableParallelToolUse,
};
```

- [ ] **Step 3: Add is_error handling for tool results**

Update the tool result message construction to include `isError` when dispatch fails:

```typescript
// Replace the existing tool result block in executeTask():
const resultValue = toolResult.ok ? toolResult.value : `Error: ${toolResult.error.message}`;
const isError = !toolResult.ok;

messages.push({
  role: 'tool',
  content: typeof resultValue === 'string' ? resultValue : JSON.stringify(resultValue),
  toolCallId: toolCall.id,
});
```

- [ ] **Step 4: Add pause_turn handling**

After the tool_use check in the loop, add a pause_turn handler:

```typescript
// After the tool_use block, before the "no tool calls" block:
if (runResult.stopReason === 'pause_turn') {
  // Server tool paused — append assistant content and continue the loop
  messages.push({
    role: 'assistant',
    content: runResult.content || '',
  });
  continue;
}
```

- [ ] **Step 5: Import ToolChoice type**

```typescript
import type { AgentRuntime, AIProvider, AgentMode, ToolChoice } from '../ai/types';
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/infra/a2a/task-manager.ts
git commit -m "feat(task-manager): add toolChoice, is_error, pause_turn support"
```

---

## Task 10: Enhance AgentCard with richer metadata

**Files:**
- Modify: `src/infra/a2a/types.ts`
- Modify: `src/infra/a2a/agent-card.ts`

- [ ] **Step 1: Extend AgentCard types**

In `src/infra/a2a/types.ts`, update `AgentCard` and `AgentSkill`:

```typescript
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications?: boolean;
    toolChoice?: boolean;             // NEW: supports tool_choice
    strictToolUse?: boolean;          // NEW: supports strict mode
    parallelToolUse?: boolean;        // NEW: supports parallel tool calls
  };
  defaultInputModes?: string[];       // NEW: e.g. ['text', 'file']
  defaultOutputModes?: string[];      // NEW: e.g. ['text', 'data']
  skills: AgentSkill[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>; // NEW: expose schema for discoverability
  tags?: string[];                       // NEW: for categorization
}
```

- [ ] **Step 2: Update buildAgentCard() to include new fields**

In `src/infra/a2a/agent-card.ts`:

```typescript
import { skillRegistry } from '../../modules/skills/skills.registry';
import type { AgentCard } from './types';

export function buildAgentCard(opts?: {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
}): AgentCard {
  const skills = skillRegistry.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    inputSchema: s.inputSchema,
    tags: [s.providerType],
  }));

  return {
    name: opts?.name ?? 'SupplyMindAI Agent',
    description: opts?.description ?? 'AI-powered supply chain management agent',
    url: opts?.url ?? process.env.A2A_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
    version: opts?.version ?? '1.0.0',
    capabilities: {
      streaming: true,
      toolChoice: true,
      strictToolUse: true,
      parallelToolUse: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'data'],
    skills,
  };
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All pass (agent-card test should still work — additive fields)

- [ ] **Step 4: Commit**

```bash
git add src/infra/a2a/types.ts src/infra/a2a/agent-card.ts
git commit -m "feat(a2a): enhance AgentCard with toolChoice, strict, inputSchema, tags"
```

---

## Task 11: Commit pending work and update existing plan

**Files:**
- Modify: `docs/superpowers/plans/2026-04-04-agent-collaboration-layer.md` (update status)

- [ ] **Step 1: Commit any remaining pending changes from previous tasks**

Check `git status` and commit the A2A `/a2a` tasks/send wiring (Task #20 from previous plan):

```bash
git add src/api/routes/public/index.ts
git commit -m "feat(a2a): wire /a2a tasks/send to taskManager with default agent config"
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All 151+ tests pass

- [ ] **Step 3: Push to PR**

```bash
git push
```

---

## Dependencies & Order

```
Task 1 (types)
  ├── Task 2 (skill hints) ← depends on Task 1
  ├── Task 3 (tool-format) ← depends on Task 1
  │     └── Tasks 5-8 (runtime adapters) ← depend on Task 3
  │           └── Task 9 (task-manager) ← depends on Tasks 5-8
  └── Task 4 (runtime-factory) ← depends on Task 1
        └── Task 9 (task-manager) ← depends on Task 4
Task 10 (agent-card) ← independent, can run any time
Task 11 (cleanup) ← last
```

Tasks 5, 6, 7, 8 are independent of each other and could run in parallel.

---

## What's NOT in this plan (deferred to future plans)

These Anthropic-specific features are acknowledged but intentionally deferred because they require significant additional infrastructure:

1. **Server tools** (web_search, code_execution) — requires Anthropic-specific tool types in the API request, different from client tools. Will need a `ServerToolProvider` skill provider type.
2. **Programmatic tool calling** (`allowed_callers: ["code_execution"]`) — requires a code execution sandbox. Out of scope.
3. **Computer use tool** — requires a virtualized desktop environment. Out of scope.
4. **Tool search** (`defer_loading` + tool_search_tool) — requires Anthropic's server-side tool search. Could be implemented as a custom client-side tool search via the skill registry. Future plan.
5. **MCP connector** (`mcp_toolset` type) — Anthropic's managed MCP integration. We have our own MCP client/server — no need for this.

These can be planned separately when the workspace/agent CRUD layer is ready.

---

## Verification

1. `bun test` — all existing + new tests pass
2. Tool format tests verify strict/cache/streaming pass-through per provider
3. Runtime factory tests verify correct adapter selection
4. ToolChoice converts correctly to each provider's format
5. AgentCard includes enriched skill metadata
6. Task manager handles pause_turn and is_error gracefully
