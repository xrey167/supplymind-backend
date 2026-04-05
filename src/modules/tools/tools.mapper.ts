import type { skillDefinitions } from '../../infra/db/schema';
import type { ToolDef, HandlerConfig } from './tools.types';

export function toToolDef(row: typeof skillDefinitions.$inferSelect): ToolDef {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    providerType: row.providerType!,
    priority: row.priority ?? 0,
    inputSchema: (row.inputSchema as Record<string, unknown>) ?? {},
    handlerConfig: (row.handlerConfig ?? { type: 'builtin' }) as HandlerConfig,
    enabled: row.enabled ?? true,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}
