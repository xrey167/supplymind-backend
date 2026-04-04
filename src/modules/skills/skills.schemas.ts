import { z } from 'zod';

export const listSkillsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});

export const invokeSkillBodySchema = z.object({
  args: z.record(z.unknown()),
});

export const skillNameParamSchema = z.object({
  name: z.string().min(1),
});
