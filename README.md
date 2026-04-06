# SupplyMindAI Backend

Multi-tenant API server for AI-powered supply chain management. Built on **Hono + Bun** with a multi-protocol agent runtime that supports MCP, A2A, WebSocket, SSE, and programmatic access through a unified gateway.

```
bun run dev       # start dev server (port 3001)
bun run build     # build to dist/
bun run test      # run tests (bun:test)
bun run db:push   # push schema (dev only)
bun run db:migrate # run migrations
bun run seed      # seed database
```

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Unified Gateway](#unified-gateway)
- [Protocol Surfaces](#protocol-surfaces)
  - [WebSocket](#websocket)
  - [A2A (Agent-to-Agent)](#a2a-agent-to-agent)
  - [MCP (Model Context Protocol)](#mcp-model-context-protocol)
  - [ACP (Agent-to-Code Protocol)](#acp-agent-to-code-protocol)
  - [A2UI (Agent-to-UI)](#a2ui-agent-to-ui)
- [Computer Use Protocol](#computer-use-protocol)
- [AI Providers](#ai-providers)
- [Skills System](#skills-system)
- [Orchestration Engine](#orchestration-engine)
- [Memory System](#memory-system)
- [Context Management](#context-management)
- [Feature Flags](#feature-flags)
- [Usage Tracking](#usage-tracking)
- [Event System](#event-system)
- [Background Jobs](#background-jobs)
- [Security](#security)
- [Observability](#observability)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [API Routes](#api-routes)

---

## Architecture Overview

```
                    ┌──────────────────────────────────────────┐
                    │              Protocol Layer               │
                    │  WebSocket  │  HTTP/A2A  │  MCP  │  ACP  │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │          Unified Gateway (execute)        │
                    │   18 ops  │  streaming  │  RBAC + audit  │
                    └──────────────────┬───────────────────────┘
                                       │
          ┌────────────────┬───────────┼───────────┬───────────────┐
          ▼                ▼           ▼           ▼               ▼
    ┌──────────┐   ┌────────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐
    │  Skills  │   │   Agents   │ │ Tasks  │ │ Sessions │ │Orchestrate │
    │ Registry │   │  Runtime   │ │ (A2A)  │ │ Context  │ │  Engine    │
    └──────────┘   └────────────┘ └────────┘ └──────────┘ └────────────┘
          │                │           │           │               │
          ▼                ▼           ▼           ▼               ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                      Infrastructure                             │
    │  Drizzle/PG  │  BullMQ/Redis  │  AI SDKs  │  MCP  │  EventBus │
    └─────────────────────────────────────────────────────────────────┘
```

Every protocol surface — WebSocket messages, A2A JSON-RPC calls, MCP tool invocations, and programmatic `GatewayClient` calls — converges into a single `execute(op, params, context)` function. This means adding a new protocol is just writing a thin adapter that maps its wire format to a `GatewayOp`.

---

## Unified Gateway

The gateway is the central dispatch layer. All operations pass through it regardless of transport.

### Operations (18 total)

| Operation | Description | Required Role |
|-----------|-------------|---------------|
| `skill.invoke` | Execute a skill by name | varies by provider |
| `skill.list` | List available skills | `viewer` |
| `task.send` | Send a task to an agent | `operator` |
| `task.get` | Get task status and artifacts | `viewer` |
| `task.cancel` | Cancel a running task | `operator` |
| `task.list` | List tasks | `viewer` |
| `task.input` | Respond to a task's input request | `operator` |
| `task.interrupt` | Interrupt a running task | `operator` |
| `agent.invoke` | Invoke an agent directly | `operator` |
| `agent.list` | List configured agents | `viewer` |
| `session.create` | Create a conversation session | `operator` |
| `session.resume` | Resume a paused session | `operator` |
| `session.addMessage` | Add a message to a session | `operator` |
| `memory.approve` | Approve a memory proposal | `operator` |
| `memory.reject` | Reject a memory proposal | `operator` |
| `orchestration.start` | Start a multi-step orchestration | `operator` |
| `orchestration.gate.respond` | Approve/deny a gate step | `operator` |
| `collaboration.start` | Start multi-agent collaboration | `admin` |
| `a2a.delegate` | Delegate to an external A2A agent | `operator` |

### Streaming Events

Every operation can optionally stream events back through an `onEvent` callback:

```typescript
type GatewayEventType =
  | 'text_delta'         // incremental text from the agent
  | 'thinking_delta'     // extended thinking content (Claude)
  | 'tool_call'          // tool invocation with status + result
  | 'status'             // task state change
  | 'artifact'           // structured output (text, data, form, table, chart, action)
  | 'round_completed'    // agent loop iteration summary with token usage
  | 'approval_required'  // tool needs user approval before executing
  | 'input_required'     // agent is asking the user a question
  | 'error'              // error event
  | 'done'               // stream complete
```

### Context

Every gateway call carries a `GatewayContext`:

```typescript
interface GatewayContext {
  callerId: string;        // "apikey:a2a_k_abc..." or Clerk user ID
  workspaceId: string;     // tenant isolation
  callerRole: Role;        // system | admin | operator | agent | viewer
  traceId?: string;        // OTel distributed tracing
  signal?: AbortSignal;    // cancellation
  sessionId?: string;      // conversation continuity
  onEvent?: (event: GatewayEvent) => void;  // streaming callback
}
```

---

## Protocol Surfaces

### WebSocket

Real-time bidirectional communication for browser clients. Supports 16 client message types and 18 server message types.

**Connection flow:**

```
Client                          Server
  │                               │
  ├──── ws://host:3001 ─────────►│  Connection opened, clientId assigned
  │                               │
  ├──── { type: "auth",          │
  │       token: "Bearer ..." } ─►│  JWT/API key validated
  │                               │
  │◄─── { type: "heartbeat" } ───┤  Every 30s
  │                               │
  ├──── { type: "task:send",     │
  │       agentId: "...",        │
  │       messages: [...] } ─────►│  Creates task via gateway
  │                               │
  │◄─── { type: "task:text_delta", delta: "Hello" } ──┤
  │◄─── { type: "task:tool_call", toolCall: {...} } ───┤  Streaming
  │◄─── { type: "task:status", status: "completed" } ──┤
```

**Client message types:**

| Type | Purpose |
|------|---------|
| `auth` | Authenticate with JWT or API key |
| `subscribe` / `unsubscribe` | Subscribe to event channels |
| `ping` | Keepalive |
| `task:send` | Send task to agent |
| `task:cancel` / `task:interrupt` | Stop a task |
| `task:input` | Respond to agent's input request |
| `task:input:approve` | Approve/deny a tool execution |
| `task:input:gate` | Approve/deny an orchestration gate |
| `skill:invoke` | Execute a skill directly |
| `session:resume` | Resume a paused session |
| `memory:approve` / `memory:reject` | Handle memory proposals |
| `a2a:send` | Delegate to external A2A agent |
| `orchestration:gate:respond` | Respond to orchestration gate |

**Channel subscription model:**

- `workspace:<id>` — workspace-scoped events (requires membership)
- `task:<id>` — auto-subscribed on task creation
- `events:skill.*` — skill execution broadcasts
- Supports wildcard patterns: `task:*`, `events:*`

---

### A2A (Agent-to-Agent)

Implementation of Google's [Agent-to-Agent protocol](https://google.github.io/A2A/) for cross-service agent communication.

**Discovery:**

```
GET /.well-known/agent.json
```

Returns the Agent Card describing capabilities, supported skills, and authentication requirements. No auth required (per A2A spec).

**Task execution:**

```
POST /a2a
Content-Type: application/json
Authorization: Bearer <api-key or JWT>

{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "params": {
    "id": "task-123",
    "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "Analyze supplier risk for Acme Corp" }]
    }
  }
}
```

**Supported JSON-RPC methods:**

| Method | Gateway Op | Description |
|--------|-----------|-------------|
| `tasks/send` | `task.send` | Create and execute a task |
| `tasks/get` | `task.get` | Poll task status |
| `tasks/cancel` | `task.cancel` | Cancel a running task |

**Task states:**

```
submitted → working → completed
                   ↘ failed
                   ↘ canceled
                   ↘ input_required → working (after user responds)
```

**Artifact types** (structured output from agents):

```typescript
type Part =
  | { kind: 'text';   text: string }
  | { kind: 'data';   data: Record<string, unknown> }
  | { kind: 'file';   file: { name: string; mimeType: string; bytes: string } }
  | { kind: 'form';   form: { schema: JsonSchema; initialValues?: Record<string, unknown> } }
  | { kind: 'table';  table: { columns: string[]; rows: unknown[][] } }
  | { kind: 'chart';  chart: { type: string; data: unknown; options?: Record<string, unknown> } }
  | { kind: 'action'; action: { label: string; actionId: string; variant?: string } }
```

**Authentication:** API keys with `a2a_k_` prefix, JWTs via Clerk, or a shared `A2A_API_KEY` env var (timing-safe comparison).

---

### MCP (Model Context Protocol)

Streamable HTTP transport at `POST /mcp`. Each registered skill and agent is exposed as an MCP tool.

```
POST /mcp
Content-Type: application/json
mcp-session-id: <session-id>
Authorization: Bearer <token>

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "analyze_risk",
    "arguments": { "supplierId": "sup-123" }
  }
}
```

**How tools are exposed:**

- **Skills → MCP tools:** Each registered skill becomes a tool with the skill's name, description, and input schema. Calling the tool triggers `skill.invoke` on the gateway.
- **Agents → MCP tools:** Each agent becomes a tool named `agent_<agentId>`. Input: `{ message: string, sessionId?: string }`. Calling it triggers `agent.invoke`, streams text deltas, and returns the final response.

**Session management:**

- Sessions keyed by `mcp-session-id` header
- 30-minute idle timeout; reaper runs every 5 minutes
- `DELETE /mcp` with session ID terminates a session (HTTP 204)

**MCP client pool:** The server can also *connect to* external MCP servers (stdio, SSE, streamable-http transports) and import their tools into the skill registry.

---

### ACP (Agent-to-Code Protocol)

Programmatic TypeScript client for calling the gateway from code — workflows, cron jobs, tests, or other services. No HTTP/WS overhead.

```typescript
import { createGatewayClient } from './core/gateway/gateway-client';

const client = createGatewayClient({
  callerId: 'workflow:daily-risk-scan',
  workspaceId: 'ws-abc123',
  callerRole: 'operator',
});

// Send a task and get the result
const result = await client.sendTask('risk-analyzer-agent', 'Analyze all suppliers');

// Stream responses
for await (const event of client.streamTask('risk-analyzer-agent', 'Generate report')) {
  if (event.type === 'text_delta') process.stdout.write(event.data.delta);
  if (event.type === 'artifact')  console.log('Artifact:', event.data);
  if (event.type === 'done')      break;
}

// Invoke a skill directly
const skills = await client.listSkills();
const result = await client.invokeSkill('health_check');

// Delegate to an external A2A agent
await client.delegateA2A('https://other-service/.well-known/agent.json', {
  message: { role: 'user', parts: [{ kind: 'text', text: 'Hello' }] },
});
```

**Full client API:**

| Method | Description |
|--------|-------------|
| `sendTask(agentId, message, opts?)` | Send a task (foreground/background) |
| `getTask(id)` | Get task status |
| `cancelTask(id)` | Cancel a task |
| `listTasks()` | List all tasks |
| `interruptTask(id)` | Interrupt a running task |
| `invokeSkill(name, args?)` | Execute a skill |
| `listSkills()` | List available skills |
| `listAgents()` | List configured agents |
| `delegateA2A(agentUrl, params?)` | Delegate to external A2A agent |
| `respondToInput(taskId, input)` | Respond to input request |
| `respondToGate(orchestrationId, stepId, approved)` | Respond to orchestration gate |
| `respondToApproval(approvalId, approved, updatedInput?)` | Approve/deny tool execution |
| `streamTask(agentId, message, opts?)` | Stream task events (AsyncGenerator) |

**Plug-and-play extensibility:**

```typescript
// Register a tool at runtime
const unregister = await client.tool({
  name: 'lookup_inventory',
  description: 'Check warehouse inventory levels',
  inputSchema: { type: 'object', properties: { sku: { type: 'string' } } },
  handler: async (args) => ({ quantity: 42, warehouse: 'WH-01' }),
});

// Register a plugin (multiple tools + hooks)
const teardown = await client.plugin({
  name: 'erp-connector',
  version: '1.0.0',
  tools: [/* ... */],
  hooks: [/* ... */],
});

// Register lifecycle hooks
const off = await client.onHook('beforeToolCall', async (event) => {
  console.log(`Tool ${event.toolName} called with`, event.args);
});
```

---

### A2UI (Agent-to-UI)

The A2UI protocol handles bidirectional communication between agents and users for approvals, input requests, and orchestration gates.

**Tool approval flow:**

When an agent calls a tool that requires user approval (based on permission mode), the system pauses execution and asks the user:

```
Agent calls tool "delete_records"
  │
  ▼
Gateway publishes TOOL_APPROVAL_REQUESTED
  │
  ▼
WS sends: { type: "tool:approval_required", approvalId, taskId, toolName, args }
  │
  ▼
User responds: { type: "task:input:approve", approvalId, approved: true }
  │
  ▼
Approval promise resolves → tool executes (or is denied)
```

**Mid-task input flow:**

Agents can pause execution to ask the user a question using the `request_user_input` builtin skill:

```
Agent calls request_user_input({ prompt: "Which supplier should I prioritize?" })
  │
  ▼
Task status → "input_required"
Gateway publishes TASK_INPUT_REQUIRED
  │
  ▼
WS sends: { type: "session:input_required", sessionId, prompt }
  │
  ▼
User responds: { type: "task:input", taskId, input: "Acme Corp" }
  │
  ▼
Task status → "working", agent resumes with user's answer
```

**Orchestration gate flow:**

Multi-step orchestrations can include gate steps that require human approval before proceeding:

```
Orchestration reaches gate step "approve-purchase-order"
  │
  ▼
WS sends: { type: "orchestration:gate", orchestrationId, stepId, prompt }
  │
  ▼
User responds: { type: "orchestration:gate:respond", orchestrationId, stepId, approved: true }
  │
  ▼
Gate promise resolves → orchestration continues to next step
```

All three flows use the same pattern: a pending promise stored in a state module (`tool-approvals.ts`, `task-inputs.ts`, `orchestration-gates.ts`) with configurable timeouts (default 5 minutes).

---

## Computer Use Protocol

Browser automation via Anthropic's Computer Use API. Agents can see and interact with web pages through screenshots and coordinate-based actions.

**Architecture:**

```
Client                     Backend                      Playwright
  │                          │                              │
  ├── POST /sessions ───────►│── chromium.launch() ────────►│
  │◄── { sessionId } ────────┤                              │
  │                          │                              │
  ├── POST /sessions/:id/run │                              │
  │   { task: "Go to..." } ──►│                              │
  │                          │── Claude loop ──────────────►│
  │                          │   screenshot → analyze       │
  │                          │   click(x,y) → screenshot    │
  │                          │   type("...") → screenshot   │
  │                          │   ... (up to 20 iterations)  │
  │◄── { output, iterations }┤                              │
  │                          │                              │
  ├── GET /sessions/:id/     │                              │
  │   screenshot ────────────►│── page.screenshot() ────────►│
  │◄── <PNG binary> ─────────┤                              │
  │                          │                              │
  ├── DELETE /sessions/:id ──►│── browser.close() ──────────►│
  │◄── 204 ──────────────────┤                              │
```

**Endpoints** (mounted at `/workspaces/:workspaceId/computer-use/sessions`):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create session (viewport: 800-1920 x 600-1080, default 1280x800) |
| `GET` | `/sessions` | List workspace sessions |
| `DELETE` | `/sessions/:id` | Destroy session (closes browser) |
| `GET` | `/sessions/:id/screenshot` | Take screenshot (PNG) |
| `POST` | `/sessions/:id/run` | Run a task (agentic loop with Claude) |

**Available tools within computer use sessions:**

| Tool | Actions |
|------|---------|
| **Computer** | `screenshot`, `left_click`, `right_click`, `double_click`, `middle_click`, `mouse_move`, `left_click_drag`, `type`, `key`, `scroll`, `cursor_position` |
| **Bash** | Execute shell commands in a persistent bash process (30s timeout) |
| **Text Editor** | `view`, `create`, `str_replace`, `insert` — sandboxed to `/tmp/cu-sessions/{sessionId}/` |

**Example:**

```bash
# Create a session
curl -X POST http://localhost:3001/api/v1/workspaces/ws-123/computer-use/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "viewportWidth": 1280, "viewportHeight": 800 }'
# → { "sessionId": "cu_abc123", "viewportWidth": 1280, "viewportHeight": 800 }

# Run a task
curl -X POST http://localhost:3001/api/v1/workspaces/ws-123/computer-use/sessions/cu_abc123/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "task": "Go to google.com and search for supply chain optimization", "maxIterations": 10 }'
# → { "output": "I navigated to Google and searched for...", "iterations": 4 }

# Take a screenshot
curl http://localhost:3001/api/v1/workspaces/ws-123/computer-use/sessions/cu_abc123/screenshot \
  -H "Authorization: Bearer $TOKEN" \
  --output screenshot.png
```

The agentic loop uses Claude with `computer-use-2025-11-24` beta, running up to 20 iterations (configurable). Each iteration: Claude sees the screenshot, decides an action, executes it via Playwright, takes a new screenshot, and repeats until the task is complete.

**Bash risk classifier:** Before executing any bash command, a lightweight classifier scores it across 6 risk dimensions (destructive, exfiltration, persistence, privilege escalation, lateral movement, obfuscation) using regex + heuristic rules. Commands above a configurable threshold are blocked or require explicit approval. A `COMPUTER_USE_BASH_WARNING` event is emitted for all non-trivial commands regardless of approval status.

---

## AI Providers

Three providers with two runtime modes each:

| Provider | Raw Runtime | Agent SDK Runtime | Vision | Tool Use | Extended Thinking |
|----------|------------|-------------------|--------|----------|-------------------|
| **Anthropic** | `AnthropicRawRuntime` | `AnthropicAgentSdkRuntime` | yes | yes | claude-opus-4-5/4-6, claude-sonnet-4-5/4-6 |
| **OpenAI** | `OpenAIRawRuntime` | `OpenAIAgentSdkRuntime` | yes | yes | no |
| **Google** | `GoogleRawRuntime` | — | yes | yes | no |

**Supported models:**

- **Anthropic:** `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`, `claude-opus-4-5`, `claude-opus-4-6`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`
- **Google:** `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`

All runtimes are wrapped with automatic retry logic (exponential backoff on retryable errors, respects abort signals). Streaming has a separate watchdog timeout.

---

## Skills System

Skills are the atomic unit of capability. Every tool, agent action, and external integration is registered as a skill.

**Provider types:**

| Type | Required Role | Source |
|------|---------------|--------|
| `builtin` | `viewer` | Hardcoded in `BuiltinSkillProvider` |
| `worker` | `agent` | BullMQ queue jobs |
| `plugin` | `agent` | Plugin tools |
| `mcp` | `operator` | External MCP servers |
| `agent` | `operator` | A2A delegation |
| `tool` | `agent` | Tool composition/aliasing |
| `inline` | `admin` | Inline code execution |

**Builtin skills:**

| Name | Description |
|------|-------------|
| `echo` | Returns input args as JSON (testing) |
| `get_time` | Returns current ISO timestamp |
| `health_check` | Returns `{ status: 'ok', timestamp }` |
| `request_user_input` | Pauses execution and asks user a question (A2UI) |

**Skill registry API:**

```typescript
skillRegistry.register(skill)       // priority-based; higher wins on name collision
skillRegistry.get('analyze_risk')   // lookup by name
skillRegistry.list()                // all registered skills
skillRegistry.invoke('echo', { message: 'test' }, context)  // execute
skillRegistry.toToolDefinitions()   // export as AI tool definitions
```

Skills loaded from: builtin provider → DB (`skill_definitions` table) → MCP servers → plugins. The registry resolves name collisions by priority (higher wins).

---

## Orchestration Engine

Multi-step workflows with dependency resolution, concurrency control, and human-in-the-loop gates.

**Step types:**

| Type | Status | Description |
|------|--------|-------------|
| `skill` | implemented | Execute a skill with template variable substitution |
| `gate` | implemented | Pause for human approval (5-min timeout) |
| `agent` | planned | Delegate to an agent |
| `collaboration` | planned | Multi-agent collaboration |
| `decision` | planned | Conditional branching |

**Example orchestration definition:**

```typescript
{
  name: 'supplier-risk-review',
  maxConcurrency: 3,
  steps: [
    {
      id: 'fetch-data',
      type: 'skill',
      skillName: 'fetch_supplier_data',
      args: { supplierId: '{{input.supplierId}}' },
    },
    {
      id: 'analyze',
      type: 'skill',
      skillName: 'analyze_risk',
      args: { data: '{{fetch-data.result}}' },
      dependsOn: ['fetch-data'],
    },
    {
      id: 'human-review',
      type: 'gate',
      prompt: 'Risk score is {{analyze.result.score}}. Approve mitigation plan?',
      dependsOn: ['analyze'],
    },
    {
      id: 'mitigate',
      type: 'skill',
      skillName: 'execute_mitigation',
      args: { plan: '{{analyze.result.plan}}' },
      dependsOn: ['human-review'],
      onError: 'retry',
      maxRetries: 3,
    },
  ],
}
```

**Execution model:**

- Topology-based scheduler: steps without `dependsOn` run first; dependents wait
- Concurrency: `maxConcurrency` (default 5) controls parallel step execution
- Template variables: `{{stepId.result}}` and `{{input.field}}` resolved at runtime
- Error handling per step: `retry` (exponential backoff, max 30s), `skip` (continue), or `fail` (default — abort orchestration)
- Deadlock detection: if pending steps exist but none are ready, fails with deadlock error

---

## Memory System

Agents can save, recall, and propose memories with vector similarity search.

```typescript
// Save a memory
await memoryService.save({
  workspaceId: 'ws-123',
  agentId: 'agent-456',       // optional — workspace-scoped if omitted
  type: 'domain',             // domain | feedback | pattern | reference
  title: 'Acme Corp risk factors',
  content: 'Acme has a history of late deliveries in Q4...',
});

// Recall relevant memories (hybrid: vector + text search)
const memories = await memoryService.recall({
  query: 'supplier risk for Acme',
  workspaceId: 'ws-123',
  agentId: 'agent-456',
  limit: 5,
});
// Returns: [{ memory, score, stale, staleDays }, ...]

// Agent proposes a memory (requires human approval)
const proposal = await memoryService.propose({
  workspaceId: 'ws-123',
  agentId: 'agent-456',
  type: 'feedback',
  title: 'User prefers brief reports',
  content: 'Always keep risk summaries under 200 words',
  evidence: 'User said "too long" in session xyz',
});
// → WS sends { type: "memory:proposal", proposal: {...} }
// → User approves/rejects via memory:approve / memory:reject
```

**Recall pipeline:** Tries hybrid search (pgvector cosine similarity + text matching), falls back to text-only. Results include a staleness indicator (>30 days = stale).

**Memory skills** (registered as builtin skills for agents to use):

| Skill | Description |
|-------|-------------|
| `remember` | Save a memory |
| `recall` | Search memories by query |
| `propose_memory` | Propose a memory for human review |
| `forget` | Delete a memory |

---

## Context Management

Automatic context window management for agent conversations.

**Compaction** kicks in when active message tokens exceed `COMPACTION_THRESHOLD_TOKENS` (120,000 — fits Claude Sonnet 4.6's 200k window with headroom for response + summary). Triggered inside `buildContextMessages` immediately before every AI invocation.

**Compaction flow:**

1. Select messages to summarize — all active except the last 6 turns (preserve immediate coherence)
2. Call summarizer model (tier-down: opus→sonnet, sonnet→haiku, haiku→haiku) with a structured prompt
3. DB transaction: mark summarized messages `isCompacted=true`, insert summary as visible `system` message (`isCompacted=false`)
4. Publish `SESSION_COMPACTED` event with before/after token counts
5. Re-fetch and return updated context

The AI call happens **before** the DB transaction — if the LLM fails, no rows are mutated (retry-safe). Up to 2 compaction passes run per `buildContextMessages` call before giving up.

**Feature flag:** `sessions.context-compaction` — when disabled, compaction never triggers.

**Summary prompt structure:** `FACTS ESTABLISHED` / `DECISIONS MADE` / `TOOL RESULTS` / `OPEN TASKS` / `CONTEXT` — structured to preserve specific IDs, values, and constraints across long sessions.

---

## Feature Flags

Per-workspace feature flags backed by `workspace_settings` with a `feature-flag:` key namespace and a 60-second in-memory LRU cache (500-entry cap, FIFO eviction).

**Default flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `computer-use.enabled` | `false` | Enable computer use sessions for workspace |
| `agent.max-iterations` | `50` | Max agent loop iterations per task |
| `agent.allow-parallel-tool-use` | `true` | Allow parallel tool calls in agent loop |
| `orchestration.max-parallel-steps` | `10` | Max concurrent orchestration steps |
| `billing.enforce-quota` | `false` | Block operations when monthly cost limit exceeded |
| `billing.monthly-cost-limit-usd` | `100` | Monthly spend cap in USD |
| `memory.vector-search` | `true` | Enable pgvector similarity search |
| `memory.auto-proposal` | `true` | Auto-propose memories after agent sessions |
| `sessions.max-active` | `20` | Max concurrent active sessions per workspace |
| `sessions.context-compaction` | `true` | Enable automatic context compaction |
| `mcp.allow-external-servers` | `true` | Allow connecting to external MCP servers |
| `observability.detailed-logging` | `false` | Enable verbose per-request logging |

**API:**

```
GET  /api/v1/workspaces/:id/feature-flags
PATCH /api/v1/workspaces/:id/feature-flags
  { "flag": "computer-use.enabled", "value": true }
```

---

## Usage Tracking

Every AI call records a usage entry: model, provider, input/output tokens, computed cost (USD), agentId, sessionId, and task context.

**Cost calculation:** Per-model pricing table (USD per 1M tokens). Includes Anthropic, OpenAI, and Google models. Unknown models fall back to a conservative default.

**API:**

```
GET /api/v1/workspaces/:id/usage?period=month
GET /api/v1/workspaces/:id/usage/records
```

Usage writes are fire-and-forget — DB failures do not propagate to the calling agent.

---

## Event System

Custom EventBus with wildcard topic matching, dead letter queue, replay, and Redis pub/sub bridge for cross-service communication.

**50 topics** across 14 categories:

| Category | Topics |
|----------|--------|
| **Skills** | `skill.registered`, `skill.invoked`, `skill.failed` |
| **Tasks** | `task.created`, `task.status`, `task.text_delta`, `task.tool_call`, `task.artifact`, `task.error`, `task.completed`, `task.canceled`, `task.unblocked`, `task.round.completed`, `task.thinking_delta` |
| **Agents** | `agent.created`, `agent.updated`, `agent.run.started`, `agent.run.completed` |
| **MCP** | `mcp.connected`, `mcp.disconnected`, `mcp.tools.discovered` |
| **Collaboration** | `collaboration.started`, `collaboration.completed` |
| **Workflows** | `workflow.started`, `workflow.step.completed`, `workflow.completed`, `workflow.failed` |
| **Sessions** | `session.created`, `session.paused`, `session.resumed`, `session.closed`, `session.compacted` |
| **Memory** | `memory.saved`, `memory.proposal`, `memory.approved`, `memory.rejected` |
| **Orchestration** | `orchestration.started`, `orchestration.step.completed`, `orchestration.gate.waiting`, `orchestration.completed`, `orchestration.failed`, `orchestration.cancelled` |
| **Task I/O** | `task.input_required`, `task.input_received` |
| **Tool Approvals** | `tool.approval_requested`, `tool.approval_resolved`, `tool.approval_expired` |
| **Security** | `security.rbac.denied`, `security.permission_mode.blocked`, `security.sandbox.executed`, `security.sandbox.failed` |
| **Coordinator** | `coordinator.phase_changed`, `coordinator.phase_completed` |
| **Verification** | `verification.verdict` |

**Redis pub/sub bridge** — bidirectional for: `task.#`, `collaboration.#`, `session.#`, `memory.#`, `orchestration.#`. Events from Redis are tagged with `redis:` source prefix to prevent infinite re-broadcast.

---

## Background Jobs

BullMQ with 5 queues on Redis:

| Queue | Schedule | Purpose |
|-------|----------|---------|
| `skill-execution` | on-demand | Skill execution via workers (concurrency: 5) |
| `agent-run` | on-demand | Agent task execution (concurrency: 3) |
| `orchestration-run` | on-demand | Orchestration execution |
| `cleanup` | `*/15 * * * *` | Stale task timeout (30min working, 60min submitted), expired sessions, expired API keys |
| `sync` | `0 * * * *` | Agent registry refresh (re-fetch Agent Cards from all registered external agents) |

---

## Security

### Authentication

Two paths, evaluated in order:

1. **API Key** — tokens with `a2a_k_` prefix, validated against `api_keys` table (bcrypt hash comparison)
2. **JWT via Clerk** — production uses `@clerk/backend` cryptographic verification; dev mode base64-decodes without verification (logged as insecure)

### Authorization (RBAC)

Role hierarchy (highest → lowest):

| Role | Level | Description |
|------|-------|-------------|
| `system` | 50 | Internal processes, orchestration engine |
| `admin` | 40 | Workspace owners, full-access API keys |
| `operator` | 30 | Human users with elevated privileges |
| `agent` | 20 | AI agents executing tools |
| `viewer` | 10 | Read-only access |

Permission check: `callerLevel >= requiredLevel`. Each skill provider type has a default required role (e.g., `builtin` → `viewer`, `mcp` → `operator`, `inline` → `admin`).

### Rate Limiting

In-memory token bucket per workspace: 200 requests/minute (full refill at interval boundary). Returns `429` with `Retry-After` and `X-RateLimit-*` headers. Stale buckets cleaned every 5 minutes.

### Security Headers

All responses include: `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `Referrer-Policy: strict-origin-when-cross-origin`, plus Hono's default secure headers (X-Content-Type-Options, X-XSS-Protection, etc.).

### CORS

Configurable via `CORS_ALLOWED_ORIGINS` env var (comma-separated). Defaults to `http://localhost:3000,http://localhost:3001` in dev. Supports `*` wildcard. All requests include `credentials: true`.

### Audit

Every request logged to EventBus (`audit.request`) with: method, path, status, duration, callerId, workspaceId, userAgent, timestamp. 4xx/5xx responses additionally logged at WARN level.

---

## Observability

### OpenTelemetry Tracing

Bun-compatible setup using `BasicTracerProvider` + `BatchSpanProcessor` + OTLP HTTP exporter. Enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

```typescript
import { withSpan } from './infra/observability/otel';

const result = await withSpan('analyze-risk', { supplierId: 'sup-123' }, async (span) => {
  // your code — automatically traced with timing + error capture
  return riskScore;
});
```

### Sentry

Error monitoring initialized before all other imports. Captures unhandled exceptions and promise rejections.

### Structured Logging

Pino-based structured JSON logging throughout. All log calls include contextual metadata (taskId, workspaceId, agentId, etc.).

---

## Database Schema

PostgreSQL via Drizzle ORM. 19 tables:

| Table | Purpose |
|-------|---------|
| `agent_configs` | AI agent configurations (provider, model, system prompt, tools) |
| `skill_definitions` | Registered skills (builtin, MCP, plugin, etc.) |
| `mcp_server_configs` | MCP server connection configs |
| `a2a_tasks` | Task execution state and artifacts |
| `task_dependencies` | Task dependency graph |
| `tool_call_logs` | Tool execution audit trail |
| `sessions` | Conversation sessions with `tokenCount` for compaction tracking |
| `session_messages` | Message history; `isCompacted` + `tokenEstimate` for soft-archive compaction |
| `agent_memories` | Agent knowledge base (with 1536-dim pgvector embeddings) |
| `memory_proposals` | Pending memory proposals for human review |
| `orchestrations` | Multi-step orchestration state |
| `workspaces` | Multi-tenant workspace isolation (soft-delete via `deletedAt`) |
| `workspace_members` | Workspace membership and roles |
| `workspace_settings` | Per-workspace key-value configuration (backing store for feature flags) |
| `workspace_invitations` | Email-based workspace invites with hashed tokens and expiry |
| `users` | Clerk-synced user records |
| `api_keys` | API key management (hashed, with prefix, role, expiry) |
| `workflow_templates` | Reusable workflow definitions |
| `registered_agents` | External A2A agent registry |

---

## Configuration

All environment variables validated at startup via Zod:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | **yes** | — | Clerk auth secret (dev mode skips verification if unset) |
| `PORT` | no | `3001` | HTTP server port |
| `NODE_ENV` | no | `development` | `development` / `production` / `test` |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis for queues, pub/sub, cache |
| `CORS_ALLOWED_ORIGINS` | no | `localhost:3000,3001` | Comma-separated allowed origins |
| `CLERK_WEBHOOK_SECRET` | no | — | Clerk webhook signature verification |
| `ANTHROPIC_API_KEY` | no | — | Anthropic Claude API |
| `OPENAI_API_KEY` | no | — | OpenAI API |
| `GOOGLE_API_KEY` | no | — | Google Gemini API |
| `AI_DEFAULT_PROVIDER` | no | `anthropic` | Default AI provider (`anthropic` / `openai` / `google`) |
| `AI_FALLBACK_ENABLED` | no | `true` | Enable automatic fallback to next provider on error |
| `MODEL_OVERRIDE_FAST` | no | — | Override fast-tier model (e.g. `claude-haiku-4-5-20251001`) |
| `MODEL_OVERRIDE_BALANCED` | no | — | Override balanced-tier model |
| `MODEL_OVERRIDE_POWERFUL` | no | — | Override powerful-tier model |
| `INTENT_GATE_ENABLED` | no | `true` | Enable intent-based model routing |
| `AI_IDEMPOTENCY_ENABLED` | no | `true` | Enable idempotency keys on AI calls |
| `COMPACTION_MAX_MESSAGES` | no | `100` | Max messages before compaction triggers |
| `COMPACTION_TOKEN_BUDGET` | no | `150000` | Token budget for compaction threshold |
| `SSE_SEQUENCE_ENABLED` | no | `true` | Enable sequence numbers on SSE events for resumption |
| `MEMORY_AUTO_EXTRACT` | no | `false` | Auto-extract memories from agent sessions |
| `NOVU_API_KEY` | no | — | Novu notification provider |
| `RESEND_API_KEY` | no | — | Resend email provider |
| `STRIPE_SECRET_KEY` | no | — | Stripe payments |
| `SENTRY_DSN` | no | — | Sentry error monitoring |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | OTel collector endpoint |
| `OTEL_SERVICE_NAME` | no | `supplymind-backend` | OTel service name |

---

## API Routes

### Workspace routes (`/api/v1/workspaces/:workspaceId/...`)

All require authentication + workspace membership + audit + rate limiting.

| Path | Module |
|------|--------|
| `/agents` | Agent CRUD + execution |
| `/tools` | Tool management |
| `/skills` | Skill invocation + listing |
| `/tasks` | Task management |
| `/collaboration` | Multi-agent collaboration |
| `/workflows` | Workflow templates |
| `/sessions` | Conversation sessions |
| `/memory` | Agent memory CRUD |
| `/orchestrations` | Orchestration execution |
| `/agent-registry` | External agent registration |
| `/mcp` | MCP server management |
| `/settings` | Workspace settings |
| `/api-keys` | API key management |
| `/computer-use/sessions` | Browser automation sessions |
| `/feature-flags` | Feature flag read + override (`GET` list, `PATCH` set) |
| `/usage` | AI usage records + cost aggregation by model/agent/period |

### User routes (`/api/v1/users/...`)

| Path | Description |
|------|-------------|
| `GET /me` | Current user profile (Clerk-synced) |
| `PATCH /me` | Update display name / preferences |

### Public routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent.json` | A2A Agent Card (unauthenticated) |
| `POST` | `/a2a` | A2A JSON-RPC endpoint |
| `POST/DELETE` | `/mcp` | MCP Streamable HTTP |
| `GET` | `/healthz` | Liveness probe |
| `GET` | `/readyz` | Readiness probe (DB + Redis) |
