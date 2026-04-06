import { z } from 'zod';

export const listNotificationsQuery = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const markReadParam = z.object({
  id: z.string().uuid(),
});

export const updatePreferencesBody = z.object({
  type: z.string(),
  channels: z.array(z.enum(['in_app', 'email', 'websocket'])).min(1),
  muted: z.boolean().optional().default(false),
});
