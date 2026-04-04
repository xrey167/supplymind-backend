export class ToolError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly code?: string,
  ) {
    super(`Tool "${toolName}" failed: ${message}`);
    this.name = 'ToolError';
  }
}

export interface ToolCallOptions {
  workspaceId: string;
  callerId?: string;
  callerRole?: string;
  traceId?: string;
  timeout?: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
