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

    await this.client.connect(transport!);
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
