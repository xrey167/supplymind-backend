import type { ToolInfo } from '../types';
import { getToolDefinitions } from '../tool-definitions';

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toOpenAITools(tools?: ToolInfo[]): OpenAITool[] {
  const defs = tools ?? getToolDefinitions();
  return defs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
