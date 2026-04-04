import { skillRegistry } from '../modules/skills/skills.registry';
import type { ToolInfo } from './types';

/** Live snapshot of currently registered tools */
export function getToolDefinitions(): ToolInfo[] {
  return skillRegistry.list().map((s) => ({
    name: s.name,
    description: s.description,
    inputSchema: s.inputSchema,
  }));
}

/** Static well-known tool names — updated by scripts/gen-tools-manifest.ts */
export type SkillId = 'echo' | 'get_time' | 'health_check' | (string & {});

/** For consumers that need a flat array at import time */
export const toolDefinitions: ToolInfo[] = [
  { name: 'echo', description: 'Returns the input arguments as a JSON string', inputSchema: { type: 'object', additionalProperties: true } },
  { name: 'get_time', description: 'Returns the current ISO timestamp', inputSchema: { type: 'object', properties: {} } },
  { name: 'health_check', description: 'Returns a health check status', inputSchema: { type: 'object', properties: {} } },
];
