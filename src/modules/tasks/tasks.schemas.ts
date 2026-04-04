import { z } from 'zod';

export const taskSendSchema = z.object({
  agentId: z.string().uuid(),
  message: z.string().min(1),
  skillId: z.string().optional(),
  args: z.record(z.unknown()).optional(),
});

export const taskIdParamSchema = z.object({
  id: z.string(),
});

export const listTasksQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
});

export const addDependencySchema = z.object({ dependsOnTaskId: z.string().uuid() });
export const dependencyParamSchema = z.object({ id: z.string(), depId: z.string() });
