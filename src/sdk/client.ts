import { dispatchSkill } from '../modules/skills/skills.dispatch';
import { skillRegistry } from '../modules/skills/skills.registry';
import { ToolError } from './types';
import type { ToolCallOptions, ToolInfo } from './types';

export class SupplyMindSDK {
  private baseUrl: string;
  private apiKey: string;
  private defaultWorkspaceId: string;

  constructor(options: { baseUrl: string; apiKey: string; workspaceId: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.defaultWorkspaceId = options.workspaceId;
  }

  /** Call a tool via HTTP API */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options?: Partial<ToolCallOptions>,
  ): Promise<unknown> {
    const workspaceId = options?.workspaceId ?? this.defaultWorkspaceId;
    const res = await fetch(
      `${this.baseUrl}/api/v1/workspaces/${workspaceId}/skills/${name}/invoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ args }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ToolError(name, body.message ?? res.statusText, String(res.status));
    }
    const data = await res.json();
    return data.result;
  }

  /** List available tools via HTTP API */
  async listTools(options?: { workspaceId?: string }): Promise<ToolInfo[]> {
    const workspaceId = options?.workspaceId ?? this.defaultWorkspaceId;
    const res = await fetch(
      `${this.baseUrl}/api/v1/workspaces/${workspaceId}/skills`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (!res.ok) throw new Error(`Failed to list tools: ${res.statusText}`);
    const data = await res.json();
    return data.skills;
  }
}

/** In-process skill call — bypasses HTTP, goes through dispatch pipeline directly */
export async function callSkill(
  name: string,
  args: Record<string, unknown>,
  options: ToolCallOptions,
): Promise<unknown> {
  const result = await dispatchSkill(name, args, {
    callerId: options.callerId ?? 'sdk',
    workspaceId: options.workspaceId,
    callerRole: (options.callerRole ?? 'admin') as any,
    traceId: options.traceId,
  });
  if (!result.ok) {
    throw new ToolError(name, result.error.message);
  }
  return result.value;
}

/** In-process tool listing — reads directly from registry */
export function listSkills(): ToolInfo[] {
  return skillRegistry.list().map((s) => ({
    name: s.name,
    description: s.description,
    inputSchema: s.inputSchema,
  }));
}
