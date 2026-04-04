import type { ToolInfo } from '../types';
import { getToolDefinitions } from '../tool-definitions';

export interface VercelAITool {
  description: string;
  parameters: Record<string, unknown>;
}

export function toVercelAITools(tools?: ToolInfo[]): Record<string, VercelAITool> {
  const defs = tools ?? getToolDefinitions();
  const result: Record<string, VercelAITool> = {};
  for (const t of defs) {
    result[t.name] = {
      description: t.description,
      parameters: t.inputSchema,
    };
  }
  return result;
}
