import { z } from 'zod';

const checkStatusSchema = z.enum(['ok', 'error']);

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    db: checkStatusSchema,
    redis: checkStatusSchema,
  }),
});
