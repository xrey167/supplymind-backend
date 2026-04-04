import type { ToolInfo } from '../types';
import { getToolDefinitions } from '../tool-definitions';

export interface GoogleTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export function toGoogleTools(tools?: ToolInfo[]): GoogleTool {
  const defs = tools ?? getToolDefinitions();
  return {
    functionDeclarations: defs.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  };
}
