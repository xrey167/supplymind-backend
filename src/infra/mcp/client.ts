import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpToolDef } from './types';

export class McpClient {
  private client: Client;
  private config: McpServerConfig;
  private connected = false;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.client = new Client({ name: `supplymind-${config.name}`, version: '1.0.0' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    let transport: ConstructorParameters<typeof Client['prototype']['connect']> extends [infer T] ? T : never;

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
        transport = new StreamableHTTPClientTransport(new URL(this.config.url!));
        break;
    }

    await this.client.connect(transport);
    this.connected = true;
  }

  async listTools(): Promise<McpToolDef[]> {
    await this.connect();
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
    const result = await this.client.callTool({ name, arguments: args });
    const textParts = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '') ?? [];
    return textParts.join('\n');
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
