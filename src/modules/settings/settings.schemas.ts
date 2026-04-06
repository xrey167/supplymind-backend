import { z } from 'zod';
import { userSettingKeySchema, setUserSettingSchema } from './user-settings/user-settings.schemas';

export { userSettingKeySchema, setUserSettingSchema };

export const userSettingKeyParamSchema = z.object({
  key: z.string(),
});

export const setUserSettingBodySchema = z.object({
  value: z.unknown(),
});
