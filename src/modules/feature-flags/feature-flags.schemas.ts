import { z } from 'zod';

export const flagValueSchema = z.union([z.boolean(), z.string(), z.number()]);

export const setFlagBodySchema = z.object({
  flag: z.string().min(1),
  value: flagValueSchema,
});

export const flagsResponseSchema = z.record(z.string(), flagValueSchema);
