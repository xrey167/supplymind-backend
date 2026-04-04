import type { ToolInfo } from '../types';
import { getToolDefinitions } from '../tool-definitions';

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toAnthropicTools(tools?: ToolInfo[]): AnthropicTool[] {
  const defs = tools ?? getToolDefinitions();
  return defs.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
