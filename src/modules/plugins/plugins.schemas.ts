import { z } from 'zod';

export const installPluginSchema = z.object({
  pluginId: z.string().uuid(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

export const pinVersionSchema = z.object({
  version: z.string().min(1),
});

export const installationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const pluginIdParamSchema = z.object({
  id: z.string().uuid(),
});
