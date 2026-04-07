import { z } from 'zod';

export const listSkillsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});

export const invokeSkillBodySchema = z.object({
  args: z.record(z.string(), z.unknown()),
});

export const skillNameParamSchema = z.object({
  name: z.string().min(1),
});

// --- Skill-embedded MCP config schemas ---

const skillMcpHttpEntrySchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const skillMcpStdioEntrySchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const skillMcpSseEntrySchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const skillMcpEntrySchema = z.discriminatedUnion('type', [
  skillMcpHttpEntrySchema,
  skillMcpStdioEntrySchema,
  skillMcpSseEntrySchema,
]);

// MCP server names: alphanumeric, hyphens, underscores only
export const skillMcpConfigSchema = z.record(
  z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'MCP name must be alphanumeric with hyphens/underscores only'),
  skillMcpEntrySchema,
);

/**
 * Validated skill MCP config. Structurally identical to SkillMcpConfig from infra/mcp/types.ts
 * — skills.schemas.ts is the single validation source; infra/mcp/types.ts is the single type source.
 */
export type SkillMcpConfigInput = z.infer<typeof skillMcpConfigSchema>;
