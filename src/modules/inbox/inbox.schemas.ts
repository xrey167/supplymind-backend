import { z } from 'zod';

export const listInboxQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  type: z.enum(['notification', 'task_update', 'system', 'alert']).optional(),
  pinned: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const inboxIdParamSchema = z.object({
  id: z.string().uuid(),
});
