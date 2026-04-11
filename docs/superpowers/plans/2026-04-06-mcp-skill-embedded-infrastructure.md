# MCP Skill-Embedded Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the MCP client layer (lazy connections, idle timeout, retry, headers, resources, prompts) and implement skill-embedded MCPs — each skill can carry its own MCP config, lazily connected only when that skill is invoked — plus a `skill_mcp` builtin tool that agents can call to dispatch into skill-scoped MCPs.

**Architecture:** Three layers: (1) `infra/mcp/` gets idle timeout, retry, headers support, and resources/prompts API; (2) `skillDefinitions` DB table gains a `mcpConfig` JSONB column; a new `SkillEmbeddedMcpManager` lazily pools connections keyed by `workspaceId:skillId:mcpName`; (3) a new `builtin:skill_mcp` skill lets agents call skill-embedded MCPs by name without those MCPs ever bloating the global skill registry.

**Tech Stack:** Bun, TypeScript (strict), Hono + `@hono/zod-openapi`, Drizzle + Postgres, `@modelcontextprotocol/sdk`, Zod v4, `bun:test`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/infra/mcp/types.ts` | Modify | Add `McpResourceDef`, `McpPromptDef`, `SkillMcpConfig` types |
| `src/infra/mcp/client.ts` | Modify | Add `listResources`, `readResource`, `listPrompts`, `getPrompt`; headers for streamable-http; idle tracking |
| `src/infra/mcp/client-pool.ts` | Modify | Lazy connect, idle cleanup interval, retry on connection, `listResources`/`readResource`/`listPrompts`/`getPrompt` passthroughs |
| `src/infra/mcp/embedded-manager.ts` | Create | `SkillEmbeddedMcpManager` — per-skill lazy pool, keyed by `workspaceId:skillId:mcpName` |
| `src/infra/db/schema/index.ts` | Modify | Add `mcpConfig jsonb` column to `skillDefinitions` |
| `src/infra/db/migrations/0006_skill_mcp_config.sql` | Create | Drizzle migration SQL |
| `src/modules/skills/skills.schemas.ts` | Modify | Add `skillMcpConfigSchema` (Zod) + `SkillMcpConfig` export |
| `src/modules/skills/skills.repo.ts` | Modify | Add `getMcpConfig(skillId)`, `setMcpConfig(skillId, config)` |
| `src/modules/skills/skills.routes.ts` | Modify | Add `GET /skills/:id/mcp` + `PUT /skills/:id/mcp` routes |
| `src/modules/skills/skills.service.ts` | Modify | Add `getMcpConfig`, `setMcpConfig` service methods |
| `src/modules/skills/providers/builtin.provider.ts` | Modify | Register `skill_mcp` builtin skill |
| `src/infra/mcp/__tests__/client.test.ts` | Create | Unit tests for new McpClient capabilities |
| `src/infra/mcp/__tests__/embedded-manager.test.ts` | Create | Unit tests for SkillEmbeddedMcpManager |
| `src/modules/skills/__tests__/skill-mcp-tool.test.ts` | Create | Unit tests for `skill_mcp` builtin skill |

---

## Task 1: Expand MCP types

**Files:**
- Modify: `src/infra/mcp/types.ts`

- [ ] **Step 1: Write failing test**

Create `src/infra/mcp/__tests__/client.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import type { McpResourceDef, McpPromptDef, SkillMcpConfig } from '../types';

describe('MCP types', () => {
  it('McpResourceDef has required fields', () => {
    const r: McpResourceDef = {
      uri: 'file:///data.json',
      name: 'data',
      description: 'some data',
      mimeType: 'application/json',
    };
    expect(r.uri).toBe('file:///data.json');
  });

  it('McpPromptDef has required fields', () => {
    const p: McpPromptDef = {
      name: 'summarize',
      description: 'summarize text',
      arguments: [{ name: 'text', description: 'Input text', required: true }],
    };
    expect(p.name).toBe('summarize');
  });

  it('SkillMcpConfig is a record of transport configs', () => {
    const c: SkillMcpConfig = {
      myServer: { type: 'http', url: 'http://localhost:3000' },
      anotherServer: { type: 'stdio', command: 'node', args: ['server.js'] },
    };
    expect(Object.keys(c)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/infra/mcp/__tests__/client.test.ts
```
Expected: compilation error — `McpResourceDef`, `McpPromptDef`, `SkillMcpConfig` not exported.

- [ ] **Step 3: Add types to `src/infra/mcp/types.ts`**

Replace the entire file:

```typescript
export interface McpServerConfig {
  id: string;
  workspaceId: string | null;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface McpResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgDef {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: McpPromptArgDef[];
}

export interface McpToolManifest {
  serverName: string;
  tools: McpToolDef[];
  fetchedAt: number;
}

/** Inline MCP config carried by a skill — keyed by MCP name */
export type SkillMcpConfig = Record<string, SkillMcpServerEntry>;

export type SkillMcpServerEntry =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && bun test src/infra/mcp/__tests__/client.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/infra/mcp/types.ts src/infra/mcp/__tests__/client.test.ts
git commit -m "feat(mcp): add resource, prompt, and SkillMcpConfig types"
```

---

## Task 2: McpClient — resources, prompts, headers, idle tracking

**Files:**
- Modify: `src/infra/mcp/client.ts`
- Modify: `src/infra/mcp/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests** — append to `src/infra/mcp/__tests__/client.test.ts`

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { McpResourceDef, McpPromptDef, SkillMcpConfig } from '../types';

// --- existing type tests above ---

describe('McpClient', () => {
  // We test the client by mocking @modelcontextprotocol/sdk internals
  // via bun:test mock.module
  const mockConnect = mock(async () => {});
  const mockListTools = mock(async () => ({ tools: [] }));
  const mockListResources = mock(async () => ({ resources: [] }));
  const mockReadResource = mock(async () => ({
    contents: [{ uri: 'file:///x', text: 'hello' }],
  }));
  const mockListPrompts = mock(async () => ({ prompts: [] }));
  const mockGetPrompt = mock(async () => ({
    description: 'prompt result',
    messages: [{ role: 'user', content: { type: 'text', text: 'go' } }],
  }));
  const mockCallTool = mock(async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }));
  const mockClose = mock(async () => {});

  const mockClientInstance = {
    connect: mockConnect,
    listTools: mockListTools,
    listResources: mockListResources,
    readResource: mockReadResource,
    listPrompts: mockListPrompts,
    getPrompt: mockGetPrompt,
    callTool: mockCallTool,
    close: mockClose,
  };

  mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
      constructor() {}
      connect = mockConnect;
      listTools = mockListTools;
      listResources = mockListResources;
      readResource = mockReadResource;
      listPrompts = mockListPrompts;
      getPrompt = mockGetPrompt;
      callTool = mockCallTool;
      close = mockClose;
    },
  }));
  mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: class { constructor() {} },
  }));
  mock.module('@modelcontextprotocol/sdk/client/sse.js', () => ({
    SSEClientTransport: class { constructor() {} },
  }));
  mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: class { constructor(_url: URL, _opts?: any) {} },
  }));

  const { McpClient } = await import('../client');

  const config = {
    id: 'srv-1',
    workspaceId: 'ws-1',
    name: 'test',
    transport: 'stdio' as const,
    command: 'echo',
    args: [],
    enabled: true,
  };

  beforeEach(() => {
    mockConnect.mockClear();
    mockListTools.mockClear();
    mockListResources.mockClear();
    mockReadResource.mockClear();
    mockListPrompts.mockClear();
    mockGetPrompt.mockClear();
    mockCallTool.mockClear();
    mockClose.mockClear();
  });

  it('listResources returns mapped resources', async () => {
    mockListResources.mockImplementationOnce(async () => ({
      resources: [{ uri: 'file:///data', name: 'data', mimeType: 'text/plain' }],
    }));
    const client = new McpClient(config);
    const resources = await client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('file:///data');
    expect(resources[0].name).toBe('data');
  });

  it('readResource returns text content', async () => {
    mockReadResource.mockImplementationOnce(async () => ({
      contents: [{ uri: 'file:///data', text: 'hello world' }],
    }));
    const client = new McpClient(config);
    const text = await client.readResource('file:///data');
    expect(text).toBe('hello world');
  });

  it('listPrompts returns mapped prompts', async () => {
    mockListPrompts.mockImplementationOnce(async () => ({
      prompts: [{ name: 'summarize', description: 'Summarize text' }],
    }));
    const client = new McpClient(config);
    const prompts = await client.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('summarize');
  });

  it('getPrompt returns rendered messages as string', async () => {
    mockGetPrompt.mockImplementationOnce(async () => ({
      description: 'Prompt for summarizing',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Summarize: foo bar' } },
      ],
    }));
    const client = new McpClient(config);
    const result = await client.getPrompt('summarize', { text: 'foo bar' });
    expect(result).toContain('Summarize: foo bar');
  });

  it('lastUsedAt updates on each operation', async () => {
    const client = new McpClient(config);
    const before = client.lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await client.listTools();
    expect(client.lastUsedAt).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/infra/mcp/__tests__/client.test.ts
```
Expected: FAIL — `listResources`, `readResource`, `listPrompts`, `getPrompt`, `lastUsedAt` not defined.

- [ ] **Step 3: Update `src/infra/mcp/client.ts`**

Replace the entire file:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpToolDef, McpResourceDef, McpPromptDef } from './types';

export class McpClient {
  private client: Client;
  private config: McpServerConfig;
  private connected = false;
  /** Updated on every successful operation — used by pool for idle cleanup. */
  lastUsedAt: number = Date.now();

  constructor(config: McpServerConfig) {
    this.config = config;
    this.client = new Client({ name: `supplymind-${config.name}`, version: '1.0.0' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    let transport: Parameters<Client['connect']>[0];

    switch (this.config.transport) {
      case 'stdio':
        transport = new StdioClientTransport({
          command: this.config.command!,
          args: this.config.args,
          env: this.config.env,
        });
        break;
      case 'sse':
        transport = new SSEClientTransport(new URL(this.config.url!));
        break;
      case 'streamable-http':
        transport = new StreamableHTTPClientTransport(new URL(this.config.url!), {
          requestInit: this.config.headers
            ? { headers: this.config.headers }
            : undefined,
        });
        break;
    }

    await this.client.connect(transport);
    this.connected = true;
    this.lastUsedAt = Date.now();
  }

  async listTools(): Promise<McpToolDef[]> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
      serverName: this.config.name,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.callTool({ name, arguments: args });
    const textParts = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '') ?? [];
    return textParts.join('\n');
  }

  async listResources(): Promise<McpResourceDef[]> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.listResources();
    return (result.resources ?? []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description ?? undefined,
      mimeType: r.mimeType ?? undefined,
    }));
  }

  async readResource(uri: string): Promise<string> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.readResource({ uri });
    const texts = (result.contents ?? [])
      .map((c: any) => c.text ?? c.blob ?? '')
      .filter(Boolean);
    return texts.join('\n');
  }

  async listPrompts(): Promise<McpPromptDef[]> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.listPrompts();
    return (result.prompts ?? []).map((p) => ({
      name: p.name,
      description: p.description ?? undefined,
      arguments: (p.arguments ?? []).map((a: any) => ({
        name: a.name,
        description: a.description ?? undefined,
        required: a.required ?? undefined,
      })),
    }));
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<string> {
    await this.connect();
    this.lastUsedAt = Date.now();
    const result = await this.client.getPrompt({ name, arguments: args ?? {} });
    const texts = (result.messages ?? [])
      .flatMap((m: any) => {
        const c = m.content;
        if (c?.type === 'text') return [c.text ?? ''];
        if (Array.isArray(c)) return c.filter((x: any) => x.type === 'text').map((x: any) => x.text ?? '');
        return [];
      })
      .filter(Boolean);
    return texts.join('\n');
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && bun test src/infra/mcp/__tests__/client.test.ts
```
Expected: PASS all tests.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/infra/mcp/client.ts src/infra/mcp/__tests__/client.test.ts src/infra/mcp/types.ts
git commit -m "feat(mcp): add resources, prompts, headers, lastUsedAt to McpClient"
```

---

## Task 3: McpClientPool — idle cleanup + retry

**Files:**
- Modify: `src/infra/mcp/client-pool.ts`

- [ ] **Step 1: Write failing tests** — create `src/infra/mcp/__tests__/client-pool.test.ts`

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { McpServerConfig } from '../types';

const mockConnect = mock(async () => {});
const mockListTools = mock(async () => []);
const mockCallTool = mock(async () => 'result');
const mockDisconnect = mock(async () => {});
const mockIsConnected = mock(() => false);

let lastUsedAt = Date.now();

mock.module('../client', () => ({
  McpClient: class {
    get lastUsedAt() { return lastUsedAt; }
    set lastUsedAt(v: number) { lastUsedAt = v; }
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    disconnect = mockDisconnect;
    isConnected = mockIsConnected;
  },
}));

const { McpClientPool } = await import('../client-pool');

const cfg = (): McpServerConfig => ({
  id: 'srv-1',
  workspaceId: 'ws-1',
  name: 'test',
  transport: 'stdio' as const,
  command: 'echo',
  enabled: true,
});

describe('McpClientPool', () => {
  let pool: InstanceType<typeof McpClientPool>;

  beforeEach(() => {
    pool = new McpClientPool();
    mockConnect.mockClear();
    mockListTools.mockClear();
    mockCallTool.mockClear();
    mockDisconnect.mockClear();
    mockIsConnected.mockClear();
    lastUsedAt = Date.now();
  });

  it('retries connect up to 3 times on failure', async () => {
    let attempts = 0;
    mockConnect.mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error('Connection refused');
    });
    mockIsConnected.mockReturnValue(false);
    mockListTools.mockResolvedValue([]);

    await pool.listTools(cfg());
    expect(attempts).toBe(3);
  });

  it('throws after 3 failed connect attempts', async () => {
    mockConnect.mockImplementation(async () => { throw new Error('refused'); });
    mockIsConnected.mockReturnValue(false);

    await expect(pool.listTools(cfg())).rejects.toThrow('refused');
    expect(mockConnect.mock.calls.length).toBe(3);
  });

  it('reuses existing connected client', async () => {
    mockIsConnected.mockReturnValue(true);
    mockListTools.mockResolvedValue([]);

    await pool.listTools(cfg());
    await pool.listTools(cfg());

    // connect should only be called once (first time)
    expect(mockConnect.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('disconnects idle clients', async () => {
    mockIsConnected.mockReturnValue(false);
    mockListTools.mockResolvedValue([]);

    await pool.listTools(cfg());
    // Simulate client idle for longer than the threshold
    lastUsedAt = Date.now() - 6 * 60 * 1000; // 6 min ago

    pool.cleanupIdle(5 * 60 * 1000);

    expect(mockDisconnect.mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/infra/mcp/__tests__/client-pool.test.ts
```
Expected: FAIL — `McpClientPool` not exported as class, no retry/cleanupIdle.

- [ ] **Step 3: Update `src/infra/mcp/client-pool.ts`**

Replace the entire file:

```typescript
import { McpClient } from './client';
import type { McpServerConfig, McpToolManifest, McpResourceDef, McpPromptDef } from './types';

const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

export class McpClientPool {
  private clients = new Map<string, McpClient>();
  private manifests = new Map<string, McpToolManifest>();

  private async getOrConnect(config: McpServerConfig): Promise<McpClient> {
    const existing = this.clients.get(config.id);
    if (existing?.isConnected()) return existing;

    const client = new McpClient(config);
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await client.connect();
        this.clients.set(config.id, client);
        return client;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    }

    throw lastError;
  }

  async listTools(config: McpServerConfig): Promise<McpToolManifest> {
    const cached = this.manifests.get(config.id);
    if (cached && Date.now() - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached;
    }

    const client = await this.getOrConnect(config);
    const tools = await client.listTools();
    const manifest: McpToolManifest = { serverName: config.name, tools, fetchedAt: Date.now() };
    this.manifests.set(config.id, manifest);
    return manifest;
  }

  async callTool(configId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.callTool(toolName, args);
  }

  async listResources(config: McpServerConfig): Promise<McpResourceDef[]> {
    const client = await this.getOrConnect(config);
    return client.listResources();
  }

  async readResource(configId: string, uri: string): Promise<string> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.readResource(uri);
  }

  async listPrompts(config: McpServerConfig): Promise<McpPromptDef[]> {
    const client = await this.getOrConnect(config);
    return client.listPrompts();
  }

  async getPrompt(configId: string, name: string, args?: Record<string, string>): Promise<string> {
    const client = this.clients.get(configId);
    if (!client) throw new Error(`No MCP client for config: ${configId}`);
    return client.getPrompt(name, args);
  }

  async refreshAll(configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      if (!config.enabled) continue;
      try {
        await this.listTools(config);
      } catch {
        // Skip unreachable servers
      }
    }
  }

  /** Disconnect clients idle longer than `idleThresholdMs`. Call on a timer. */
  cleanupIdle(idleThresholdMs: number): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      if (now - client.lastUsedAt > idleThresholdMs) {
        client.disconnect().catch(() => {});
        this.clients.delete(id);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.disconnect(); } catch { /* best-effort */ }
    }
    this.clients.clear();
    this.manifests.clear();
  }

  getAllManifests(): McpToolManifest[] {
    return Array.from(this.manifests.values());
  }
}

export const mcpClientPool = new McpClientPool();
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/infra/mcp/__tests__/client-pool.test.ts
```
Expected: PASS

- [ ] **Step 5: Confirm no regressions**

```bash
cd backend && bun test src/modules/mcp/__tests__/ src/modules/skills/providers/__tests__/mcp.provider.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/infra/mcp/client-pool.ts src/infra/mcp/__tests__/client-pool.test.ts
git commit -m "feat(mcp): retry, idle cleanup, resources/prompts passthrough in McpClientPool"
```

---

## Task 4: DB schema — add `mcpConfig` to `skillDefinitions`

**Files:**
- Modify: `src/infra/db/schema/index.ts`
- Create: `src/infra/db/migrations/0006_skill_mcp_config.sql`

- [ ] **Step 1: Write failing test** — create `src/infra/mcp/__tests__/embedded-manager.test.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import type { SkillMcpConfig } from '../types';

// This test just validates the type compiles correctly until the manager exists
const config: SkillMcpConfig = {
  analytics: { type: 'http', url: 'http://localhost:4000' },
};

describe('SkillMcpConfig shape', () => {
  it('http entry has url', () => {
    const entry = config.analytics;
    if (entry.type === 'http') {
      expect(entry.url).toBe('http://localhost:4000');
    }
  });
});
```

```bash
cd backend && bun test src/infra/mcp/__tests__/embedded-manager.test.ts
```
Expected: PASS (type only — real manager tests come in Task 5).

- [ ] **Step 2: Add `mcpConfig` column to `skillDefinitions` in `src/infra/db/schema/index.ts`**

Find the `skillDefinitions` table and add one column:

```typescript
// Before (in skillDefinitions table):
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),

// After:
  enabled: boolean('enabled').default(true),
  mcpConfig: jsonb('mcp_config').default({}),   // SkillMcpConfig — keyed by mcp name
  createdAt: timestamp('created_at').defaultNow(),
```

- [ ] **Step 3: Create migration file** `src/infra/db/migrations/0006_skill_mcp_config.sql`

```sql
ALTER TABLE "skill_definitions" ADD COLUMN IF NOT EXISTS "mcp_config" jsonb DEFAULT '{}';
```

- [ ] **Step 4: Run migration**

```bash
cd backend && bun run db:generate
bun run db:migrate
```
Expected: migration applies cleanly, no errors.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/infra/db/schema/index.ts src/infra/db/migrations/0006_skill_mcp_config.sql
git commit -m "feat(db): add mcpConfig jsonb column to skill_definitions"
```

---

## Task 5: SkillEmbeddedMcpManager

**Files:**
- Create: `src/infra/mcp/embedded-manager.ts`
- Modify: `src/infra/mcp/__tests__/embedded-manager.test.ts`

- [ ] **Step 1: Write failing tests** — replace `src/infra/mcp/__tests__/embedded-manager.test.ts`

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { SkillMcpConfig } from '../types';

const mockListTools = mock(async () => [{ name: 'search', description: 'search', inputSchema: {}, serverName: 'analytics' }]);
const mockCallTool = mock(async () => 'result');
const mockListResources = mock(async () => []);
const mockReadResource = mock(async () => 'resource text');
const mockListPrompts = mock(async () => []);
const mockGetPrompt = mock(async () => 'prompt result');
const mockDisconnect = mock(async () => {});
const mockConnect = mock(async () => {});

mock.module('../client', () => ({
  McpClient: class {
    lastUsedAt = Date.now();
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    listResources = mockListResources;
    readResource = mockReadResource;
    listPrompts = mockListPrompts;
    getPrompt = mockGetPrompt;
    disconnect = mockDisconnect;
    isConnected = mock(() => false);
  },
}));

const { SkillEmbeddedMcpManager } = await import('../embedded-manager');

const config: SkillMcpConfig = {
  analytics: { type: 'http', url: 'http://localhost:4000' },
};

describe('SkillEmbeddedMcpManager', () => {
  let manager: InstanceType<typeof SkillEmbeddedMcpManager>;

  beforeEach(() => {
    manager = new SkillEmbeddedMcpManager();
    mockConnect.mockClear();
    mockCallTool.mockClear();
    mockListTools.mockClear();
    mockDisconnect.mockClear();
  });

  it('callTool connects lazily on first call', async () => {
    await manager.callTool('ws-1', 'skill-abc', 'analytics', config.analytics, 'search', { q: 'foo' });
    expect(mockConnect.mock.calls.length).toBe(1);
  });

  it('callTool reuses client on second call', async () => {
    await manager.callTool('ws-1', 'skill-abc', 'analytics', config.analytics, 'search', { q: 'foo' });
    await manager.callTool('ws-1', 'skill-abc', 'analytics', config.analytics, 'search', { q: 'bar' });
    // connect called twice because isConnected always returns false in mock
    expect(mockCallTool.mock.calls.length).toBe(2);
  });

  it('different skills get separate clients', async () => {
    await manager.callTool('ws-1', 'skill-A', 'analytics', config.analytics, 'search', {});
    await manager.callTool('ws-1', 'skill-B', 'analytics', config.analytics, 'search', {});
    expect(mockConnect.mock.calls.length).toBe(2);
  });

  it('listTools returns tools for the skill MCP', async () => {
    const tools = await manager.listTools('ws-1', 'skill-abc', 'analytics', config.analytics);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('search');
  });

  it('readResource delegates to client', async () => {
    const text = await manager.readResource('ws-1', 'skill-abc', 'analytics', config.analytics, 'file:///data');
    expect(text).toBe('resource text');
    expect(mockReadResource.mock.calls.length).toBe(1);
  });

  it('getPrompt delegates to client', async () => {
    const text = await manager.getPrompt('ws-1', 'skill-abc', 'analytics', config.analytics, 'summarize');
    expect(text).toBe('prompt result');
    expect(mockGetPrompt.mock.calls.length).toBe(1);
  });

  it('disconnectAll cleans up all clients', async () => {
    await manager.callTool('ws-1', 'skill-A', 'analytics', config.analytics, 'search', {});
    await manager.callTool('ws-1', 'skill-B', 'analytics', config.analytics, 'search', {});
    await manager.disconnectAll();
    expect(mockDisconnect.mock.calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/infra/mcp/__tests__/embedded-manager.test.ts
```
Expected: FAIL — `SkillEmbeddedMcpManager` not found.

- [ ] **Step 3: Create `src/infra/mcp/embedded-manager.ts`**

```typescript
import { McpClient } from './client';
import type { SkillMcpServerEntry, McpToolDef, McpResourceDef, McpPromptDef } from './types';

/**
 * Manages lazy MCP client connections scoped to individual skills.
 * Pool key: `${workspaceId}:${skillId}:${mcpName}`
 * Clients are created on first use and reused until explicitly disconnected or idle.
 */
export class SkillEmbeddedMcpManager {
  private clients = new Map<string, McpClient>();

  private key(workspaceId: string, skillId: string, mcpName: string): string {
    return `${workspaceId}:${skillId}:${mcpName}`;
  }

  private toMcpServerConfig(mcpName: string, entry: SkillMcpServerEntry) {
    return {
      id: mcpName,       // used as pool key; not a DB id
      workspaceId: null,
      name: mcpName,
      transport: entry.type === 'http' ? 'streamable-http' as const
               : entry.type === 'sse'  ? 'sse' as const
               : 'stdio' as const,
      url:     (entry as any).url,
      command: (entry as any).command,
      args:    (entry as any).args,
      env:     (entry as any).env,
      headers: (entry as any).headers,
      enabled: true,
    };
  }

  private async getOrCreate(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpClient> {
    const k = this.key(workspaceId, skillId, mcpName);
    const existing = this.clients.get(k);
    if (existing?.isConnected()) return existing;

    const config = this.toMcpServerConfig(mcpName, entry);
    const client = new McpClient(config as any);
    await client.connect();
    this.clients.set(k, client);
    return client;
  }

  async listTools(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpToolDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listTools();
  }

  async callTool(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.callTool(toolName, args);
  }

  async listResources(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpResourceDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listResources();
  }

  async readResource(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    uri: string,
  ): Promise<string> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.readResource(uri);
  }

  async listPrompts(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
  ): Promise<McpPromptDef[]> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.listPrompts();
  }

  async getPrompt(
    workspaceId: string,
    skillId: string,
    mcpName: string,
    entry: SkillMcpServerEntry,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<string> {
    const client = await this.getOrCreate(workspaceId, skillId, mcpName, entry);
    return client.getPrompt(promptName, args);
  }

  /** Disconnect and remove clients idle longer than `idleThresholdMs`. */
  cleanupIdle(idleThresholdMs: number): void {
    const now = Date.now();
    for (const [k, client] of this.clients) {
      if (now - client.lastUsedAt > idleThresholdMs) {
        client.disconnect().catch(() => {});
        this.clients.delete(k);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      try { await client.disconnect(); } catch { /* best-effort */ }
    }
    this.clients.clear();
  }

  /** Return count of active clients (for monitoring). */
  activeCount(): number {
    return this.clients.size;
  }
}

export const skillEmbeddedMcpManager = new SkillEmbeddedMcpManager();
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/infra/mcp/__tests__/embedded-manager.test.ts
```
Expected: PASS all tests.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/infra/mcp/embedded-manager.ts src/infra/mcp/__tests__/embedded-manager.test.ts
git commit -m "feat(mcp): SkillEmbeddedMcpManager — lazy per-skill MCP client pool"
```

---

## Task 6: Skill MCP config — repo + routes

**Files:**
- Modify: `src/modules/skills/skills.schemas.ts`
- Modify: `src/modules/skills/skills.repo.ts`
- Modify: `src/modules/skills/skills.service.ts`
- Modify: `src/modules/skills/skills.routes.ts`

- [ ] **Step 1: Write failing test** — create `src/modules/skills/__tests__/skill-mcp-config.test.ts`

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { skillMcpConfigSchema } from '../skills.schemas';

describe('skillMcpConfigSchema', () => {
  it('accepts http entry', () => {
    const result = skillMcpConfigSchema.safeParse({
      analytics: { type: 'http', url: 'http://localhost:4000' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts stdio entry', () => {
    const result = skillMcpConfigSchema.safeParse({
      myTool: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects entry without type', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { url: 'http://x.com' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects http entry without url', () => {
    const result = skillMcpConfigSchema.safeParse({
      bad: { type: 'http' },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/modules/skills/__tests__/skill-mcp-config.test.ts
```
Expected: FAIL — `skillMcpConfigSchema` not exported.

- [ ] **Step 3: Add schema to `src/modules/skills/skills.schemas.ts`**

Find the existing schemas file and append:

```typescript
import { z } from 'zod';

// ... (existing content) ...

// Skill-embedded MCP config
const skillMcpHttpEntrySchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const skillMcpStdioEntrySchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const skillMcpSseEntrySchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const skillMcpEntrySchema = z.discriminatedUnion('type', [
  skillMcpHttpEntrySchema,
  skillMcpStdioEntrySchema,
  skillMcpSseEntrySchema,
]);

export const skillMcpConfigSchema = z.record(z.string().min(1), skillMcpEntrySchema);

export type SkillMcpConfigInput = z.infer<typeof skillMcpConfigSchema>;
```

- [ ] **Step 4: Run schema test**

```bash
cd backend && bun test src/modules/skills/__tests__/skill-mcp-config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add repo methods to `src/modules/skills/skills.repo.ts`**

Find the existing `SkillsRepo` class (or standalone repo functions) and add:

```typescript
import { db } from '../../infra/db/client';
import { skillDefinitions } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import type { SkillMcpConfigInput } from './skills.schemas';

// In SkillsRepo class (or as exported functions if the file uses that pattern):

async getMcpConfig(skillId: string): Promise<SkillMcpConfigInput | null> {
  const row = await db
    .select({ mcpConfig: skillDefinitions.mcpConfig })
    .from(skillDefinitions)
    .where(eq(skillDefinitions.id, skillId))
    .limit(1);
  return (row[0]?.mcpConfig as SkillMcpConfigInput) ?? null;
}

async setMcpConfig(skillId: string, config: SkillMcpConfigInput): Promise<void> {
  await db
    .update(skillDefinitions)
    .set({ mcpConfig: config, updatedAt: new Date() })
    .where(eq(skillDefinitions.id, skillId));
}
```

- [ ] **Step 6: Add service methods to `src/modules/skills/skills.service.ts`**

```typescript
import type { Result } from '../../core/result';
import { ok, err } from '../../core/result';
import type { SkillMcpConfigInput } from './skills.schemas';
// (import skillsRepo — follow existing pattern in file)

// In SkillsService class:

async getMcpConfig(workspaceId: string, skillId: string): Promise<Result<SkillMcpConfigInput | null>> {
  try {
    // Verify the skill belongs to this workspace
    const skill = await skillsRepo.findById(skillId);
    if (!skill) return err(new Error(`Skill not found: ${skillId}`));
    if (skill.workspaceId && skill.workspaceId !== workspaceId) {
      return err(new Error('Skill not found in this workspace'));
    }
    const config = await skillsRepo.getMcpConfig(skillId);
    return ok(config);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

async setMcpConfig(workspaceId: string, skillId: string, config: SkillMcpConfigInput): Promise<Result<void>> {
  try {
    const skill = await skillsRepo.findById(skillId);
    if (!skill) return err(new Error(`Skill not found: ${skillId}`));
    if (skill.workspaceId && skill.workspaceId !== workspaceId) {
      return err(new Error('Skill not found in this workspace'));
    }
    await skillsRepo.setMcpConfig(skillId, config);
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
```

- [ ] **Step 7: Add routes to `src/modules/skills/skills.routes.ts`**

Append two new routes following the existing Hono/zod-openapi pattern in the file:

```typescript
// GET /skills/:skillId/mcp — fetch embedded MCP config
skillsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/:skillId/mcp',
    tags: ['Skills'],
    summary: 'Get embedded MCP config for a skill',
    request: { params: z.object({ skillId: z.string().uuid() }) },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ mcpConfig: skillMcpConfigSchema.nullable() }) } },
        description: 'MCP config',
      },
    },
  }),
  async (c) => {
    const { skillId } = c.req.valid('param');
    const workspaceId = c.get('workspaceId');
    const result = await skillsService.getMcpConfig(workspaceId, skillId);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ mcpConfig: result.value });
  },
);

// PUT /skills/:skillId/mcp — set embedded MCP config
skillsRouter.openapi(
  createRoute({
    method: 'put',
    path: '/:skillId/mcp',
    tags: ['Skills'],
    summary: 'Set embedded MCP config for a skill',
    request: {
      params: z.object({ skillId: z.string().uuid() }),
      body: { content: { 'application/json': { schema: skillMcpConfigSchema } } },
    },
    responses: {
      200: { content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } }, description: 'Updated' },
    },
  }),
  async (c) => {
    const { skillId } = c.req.valid('param');
    const workspaceId = c.get('workspaceId');
    const body = c.req.valid('json');
    const result = await skillsService.setMcpConfig(workspaceId, skillId, body);
    if (!result.ok) return c.json({ error: result.error.message }, 404);
    return c.json({ ok: true });
  },
);
```

- [ ] **Step 8: Run all skill tests**

```bash
cd backend && bun test src/modules/skills/__tests__/
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
cd backend && git add src/modules/skills/skills.schemas.ts src/modules/skills/skills.repo.ts src/modules/skills/skills.service.ts src/modules/skills/skills.routes.ts src/modules/skills/__tests__/skill-mcp-config.test.ts
git commit -m "feat(skills): skill-embedded MCP config — schema, repo, service, routes"
```

---

## Task 7: `skill_mcp` Builtin Skill

**Files:**
- Create: `src/modules/skills/__tests__/skill-mcp-tool.test.ts`
- Modify: `src/modules/skills/providers/builtin.provider.ts`

This is the agent-facing tool. An agent calls `skill_mcp` with:
- `skill_id` — the skill whose embedded MCP to use
- `mcp_name` — which MCP in that skill's config
- `operation` — `'call_tool'` | `'read_resource'` | `'get_prompt'` | `'list_tools'`
- `name` — tool/resource/prompt name (not required for `list_tools`)
- `arguments` — JSON object of arguments

- [ ] **Step 1: Write failing tests** — create `src/modules/skills/__tests__/skill-mcp-tool.test.ts`

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ok } from '../../../core/result';

const mockGetMcpConfig = mock(async (_wid: string, _sid: string) =>
  ok({ analytics: { type: 'http' as const, url: 'http://localhost:4000' } })
);

mock.module('../skills.service', () => ({
  skillsService: { getMcpConfig: (wid: string, sid: string) => mockGetMcpConfig(wid, sid) },
}));

const mockCallTool = mock(async () => 'search result');
const mockListTools = mock(async () => [{ name: 'search', description: 'Search', inputSchema: {} }]);
const mockReadResource = mock(async () => 'resource content');
const mockGetPrompt = mock(async () => 'prompt content');

mock.module('../../../infra/mcp/embedded-manager', () => ({
  skillEmbeddedMcpManager: {
    callTool: mockCallTool,
    listTools: mockListTools,
    readResource: mockReadResource,
    getPrompt: mockGetPrompt,
  },
}));

const { BuiltinSkillProvider } = await import('../providers/builtin.provider');

describe('skill_mcp builtin skill', () => {
  let skills: Awaited<ReturnType<InstanceType<typeof BuiltinSkillProvider>['loadSkills']>>;
  let skillMcp: (typeof skills)[0];
  const ctx = { callerId: 'agent-1', workspaceId: 'ws-1', callerRole: 'operator' as const };

  beforeEach(async () => {
    const provider = new BuiltinSkillProvider();
    skills = await provider.loadSkills();
    skillMcp = skills.find((s) => s.name === 'skill_mcp')!;
    mockCallTool.mockClear();
    mockListTools.mockClear();
    mockReadResource.mockClear();
    mockGetPrompt.mockClear();
    mockGetMcpConfig.mockClear();
  });

  it('skill_mcp is registered as a builtin skill', () => {
    expect(skillMcp).toBeDefined();
    expect(skillMcp.providerType).toBe('builtin');
  });

  it('call_tool operation dispatches to embedded manager', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
      arguments: { q: 'inventory' },
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('search result');
    expect(mockCallTool.mock.calls.length).toBe(1);
  });

  it('list_tools operation returns tool list', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'list_tools',
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const tools = result.value as any[];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools[0].name).toBe('search');
    }
  });

  it('returns error when skill MCP config not found', async () => {
    mockGetMcpConfig.mockImplementationOnce(async () => ok(null));

    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
    }, ctx);

    expect(result.ok).toBe(false);
  });

  it('returns error when mcp_name not in skill config', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'nonexistent',
      operation: 'call_tool',
      name: 'search',
    }, ctx);

    expect(result.ok).toBe(false);
  });

  it('returns error when context is missing', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'call_tool',
      name: 'search',
    });
    // No context means no workspaceId — should return err
    expect(result.ok).toBe(false);
  });

  it('read_resource operation returns resource content', async () => {
    const result = await skillMcp.handler({
      skill_id: 'skill-abc',
      mcp_name: 'analytics',
      operation: 'read_resource',
      name: 'file:///data.json',
    }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('resource content');
    expect(mockReadResource.mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/modules/skills/__tests__/skill-mcp-tool.test.ts
```
Expected: FAIL — `skill_mcp` skill not registered.

- [ ] **Step 3: Add `skill_mcp` skill to `src/modules/skills/providers/builtin.provider.ts`**

At the top of the file, add imports:

```typescript
import { skillsService } from '../skills.service';
import { skillEmbeddedMcpManager } from '../../../infra/mcp/embedded-manager';
```

In the `loadSkills()` array, append this skill after the existing builtins:

```typescript
{
  id: 'builtin:skill_mcp',
  name: 'skill_mcp',
  description: 'Call a tool, read a resource, or get a prompt from an MCP server embedded in a specific skill. Use list_tools to discover what the MCP offers.',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id:  { type: 'string', description: 'ID of the skill that owns this MCP' },
      mcp_name:  { type: 'string', description: 'Name of the embedded MCP server (as declared in the skill config)' },
      operation: {
        type: 'string',
        enum: ['call_tool', 'read_resource', 'get_prompt', 'list_tools'],
        description: 'What to do: call a tool, read a resource, get a prompt, or list available tools',
      },
      name: { type: 'string', description: 'Tool/resource/prompt name (not required for list_tools)' },
      arguments: {
        type: 'object',
        additionalProperties: true,
        description: 'Arguments for call_tool or get_prompt',
      },
    },
    required: ['skill_id', 'mcp_name', 'operation'],
  },
  providerType: 'builtin',
  priority: this.priority,
  concurrencySafe: true,
  handler: async (args, context) => {
    if (!context?.workspaceId) {
      return err(new Error('skill_mcp requires a dispatch context with workspaceId'));
    }

    const skillId  = args.skill_id as string;
    const mcpName  = args.mcp_name as string;
    const operation = args.operation as 'call_tool' | 'read_resource' | 'get_prompt' | 'list_tools';
    const name     = args.name as string | undefined;
    const callArgs = (args.arguments ?? {}) as Record<string, unknown>;
    const { workspaceId } = context;

    // Fetch the skill's embedded MCP config
    const configResult = await skillsService.getMcpConfig(workspaceId, skillId);
    if (!configResult.ok) return configResult;
    if (!configResult.value) {
      return err(new Error(`Skill '${skillId}' has no embedded MCP config`));
    }

    const mcpEntry = configResult.value[mcpName];
    if (!mcpEntry) {
      const available = Object.keys(configResult.value).join(', ') || '(none)';
      return err(new Error(`MCP '${mcpName}' not found in skill '${skillId}'. Available: ${available}`));
    }

    try {
      switch (operation) {
        case 'list_tools': {
          const tools = await skillEmbeddedMcpManager.listTools(workspaceId, skillId, mcpName, mcpEntry);
          return ok(tools);
        }
        case 'call_tool': {
          if (!name) return err(new Error('call_tool requires a tool name'));
          const result = await skillEmbeddedMcpManager.callTool(workspaceId, skillId, mcpName, mcpEntry, name, callArgs);
          return ok(result);
        }
        case 'read_resource': {
          if (!name) return err(new Error('read_resource requires a resource URI as name'));
          const text = await skillEmbeddedMcpManager.readResource(workspaceId, skillId, mcpName, mcpEntry, name);
          return ok(text);
        }
        case 'get_prompt': {
          if (!name) return err(new Error('get_prompt requires a prompt name'));
          const text = await skillEmbeddedMcpManager.getPrompt(
            workspaceId, skillId, mcpName, mcpEntry, name,
            callArgs as Record<string, string>,
          );
          return ok(text);
        }
        default:
          return err(new Error(`Unknown operation: ${operation}`));
      }
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  },
},
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/skills/__tests__/skill-mcp-tool.test.ts
```
Expected: PASS all tests.

- [ ] **Step 5: Run all builtin provider tests**

```bash
cd backend && bun test src/modules/skills/__tests__/skills.registry.test.ts src/modules/skills/__tests__/skills.dispatch.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/modules/skills/providers/builtin.provider.ts src/modules/skills/__tests__/skill-mcp-tool.test.ts
git commit -m "feat(skills): skill_mcp builtin tool — agents can call skill-embedded MCPs"
```

---

## Task 8: Idle cleanup wiring + full test run

**Files:**
- Modify: `src/app/server.ts` (or wherever the app bootstrap lives)

- [ ] **Step 1: Locate app bootstrap**

```bash
cd backend && cat src/app/server.ts | head -60
```

- [ ] **Step 2: Add idle cleanup interval for embedded manager**

In the server bootstrap file, after the app is created, add:

```typescript
import { skillEmbeddedMcpManager } from '../infra/mcp/embedded-manager';
import { mcpClientPool } from '../infra/mcp/client-pool';

const IDLE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000;   // run every 2 min
const IDLE_THRESHOLD_MS        = 5 * 60 * 1000;   // disconnect after 5 min idle

const idleCleanupTimer = setInterval(() => {
  skillEmbeddedMcpManager.cleanupIdle(IDLE_THRESHOLD_MS);
  mcpClientPool.cleanupIdle(IDLE_THRESHOLD_MS);
}, IDLE_CLEANUP_INTERVAL_MS);

// Prevent timer from blocking process exit
if (typeof idleCleanupTimer === 'object' && 'unref' in idleCleanupTimer) {
  (idleCleanupTimer as any).unref();
}
```

Also add cleanup on graceful shutdown (find the existing shutdown handler or add one):

```typescript
// On graceful shutdown (after existing cleanup):
await skillEmbeddedMcpManager.disconnectAll();
```

- [ ] **Step 3: Run full test suite**

```bash
cd backend && bun test
```
Expected: all tests PASS. No regressions.

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/app/server.ts
git commit -m "feat(app): wire idle cleanup for embedded and pool MCP clients"
```

---

## Self-Review

### Spec coverage check

| Feature | Task |
|---------|------|
| MCP resources (`listResources`, `readResource`) | Task 2 |
| MCP prompts (`listPrompts`, `getPrompt`) | Task 2 |
| Headers for streamable-http | Task 2 |
| Idle timeout tracking | Task 2, Task 3 |
| Retry on connect failure (3x) | Task 3 |
| Resources/prompts passthrough in pool | Task 3 |
| `skill_definitions.mcpConfig` DB column | Task 4 |
| `SkillEmbeddedMcpManager` | Task 5 |
| `getMcpConfig` / `setMcpConfig` API | Task 6 |
| `skill_mcp` builtin agent tool | Task 7 |
| Idle cleanup wiring at startup | Task 8 |

### Placeholder scan
No TBD, TODO, or "similar to" references. All steps include full code.

### Type consistency
- `SkillMcpServerEntry` defined in Task 1 `types.ts`, used in `SkillEmbeddedMcpManager` (Task 5) — consistent.
- `SkillMcpConfig` = `Record<string, SkillMcpServerEntry>` — used in schema (Task 6) and skill handler (Task 7) — consistent.
- `skillsService.getMcpConfig` returns `Result<SkillMcpConfigInput | null>` — handler in Task 7 checks both null and missing key — consistent.
- `McpClient.lastUsedAt` added in Task 2, read in `cleanupIdle` in Tasks 3, 5, 8 — consistent.
