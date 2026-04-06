import { z } from 'zod';

export const UserSettingKeys = {
  THEME: 'theme',
  LOCALE: 'locale',
  TIMEZONE: 'timezone',
  NOTIFICATIONS_EMAIL: 'notifications_email',
  NOTIFICATIONS_PUSH: 'notifications_push',
  AI_DEFAULT_MODEL: 'ai_default_model',
  AI_DEFAULT_TEMPERATURE: 'ai_default_temperature',
  DASHBOARD_LAYOUT: 'dashboard_layout',
  DASHBOARD_PINNED_AGENTS: 'dashboard_pinned_agents',
} as const;

export type UserSettingKey = (typeof UserSettingKeys)[keyof typeof UserSettingKeys];

export const userSettingKeySchema = z.enum([
  'theme',
  'locale',
  'timezone',
  'notifications_email',
  'notifications_push',
  'ai_default_model',
  'ai_default_temperature',
  'dashboard_layout',
  'dashboard_pinned_agents',
]);

export const getUserSettingParamSchema = z.object({
  key: userSettingKeySchema,
});

export const setUserSettingSchema = z.object({
  value: z.unknown(),
});

/** Per-key value validation */
export const userSettingValueSchemas: Record<string, z.ZodType> = {
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.string().min(2).max(10),
  timezone: z.string().min(1).max(64),
  notifications_email: z.boolean(),
  notifications_push: z.boolean(),
  ai_default_model: z.string().min(1).max(128),
  ai_default_temperature: z.number().min(0).max(2),
  dashboard_layout: z.enum(['default', 'compact', 'wide']),
  dashboard_pinned_agents: z.array(z.string()),
};

export const USER_SETTING_DEFAULTS: Record<string, unknown> = {
  theme: 'system',
  locale: 'en',
  timezone: 'UTC',
  notifications_email: true,
  notifications_push: true,
  ai_default_model: 'claude-sonnet-4-6',
  ai_default_temperature: 0.7,
  dashboard_layout: 'default',
  dashboard_pinned_agents: [],
};
