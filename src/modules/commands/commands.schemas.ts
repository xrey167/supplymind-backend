import { z } from 'zod';

export const commandSourceSchema = z.enum(['global', 'workspace', 'builtin']);
export type CommandSource = z.infer<typeof commandSourceSchema>;

export const commandDtoSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  source: commandSourceSchema,
  providerType: z.string(),
});
export type CommandDto = z.infer<typeof commandDtoSchema>;

export const listCommandsQuerySchema = z.object({
  source: commandSourceSchema.optional(),
});
