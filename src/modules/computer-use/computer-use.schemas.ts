import { z } from 'zod';

export const createSessionSchema = z.object({
  viewportWidth: z.number().int().min(800).max(1920).default(1280),
  viewportHeight: z.number().int().min(600).max(1080).default(800),
});

export const runTaskSchema = z.object({
  task: z.string().min(1).max(4000),
  model: z.string().optional().default('claude-sonnet-4-6'),
  maxIterations: z.number().int().min(1).max(50).default(20),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RunTaskInput = z.infer<typeof runTaskSchema>;
