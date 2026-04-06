import { z } from 'zod';

export const createCheckoutSchema = z.object({
  planTier: z.enum(['starter', 'pro', 'enterprise']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const portalSessionSchema = z.object({
  returnUrl: z.string().url(),
});

export const invoiceListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
});
