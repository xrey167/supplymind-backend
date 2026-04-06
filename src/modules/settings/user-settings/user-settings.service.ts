import { userSettingsRepo } from './user-settings.repo';
import { userSettingValueSchemas, USER_SETTING_DEFAULTS } from './user-settings.schemas';
import { logger } from '../../../config/logger';

export class UserSettingsService {
  async get(userId: string, key: string): Promise<unknown | null> {
    return userSettingsRepo.get(userId, key);
  }

  async set(userId: string, key: string, value: unknown): Promise<void> {
    const schema = userSettingValueSchemas[key];
    if (schema) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        logger.warn({ userId, key, value, error: parsed.error.message }, 'Invalid user setting value');
        throw new Error(`Invalid value for setting "${key}": ${parsed.error.message}`);
      }
      await userSettingsRepo.set(userId, key, parsed.data);
    } else {
      await userSettingsRepo.set(userId, key, value);
    }
  }

  async getAll(userId: string): Promise<Record<string, unknown>> {
    const stored = await userSettingsRepo.getAll(userId);
    return { ...USER_SETTING_DEFAULTS, ...stored };
  }

  async delete(userId: string, key: string): Promise<boolean> {
    return userSettingsRepo.delete(userId, key);
  }

  // --- Typed getters ---

  async getTheme(userId: string): Promise<string> {
    return (await this.get(userId, 'theme') as string) ?? (USER_SETTING_DEFAULTS.theme as string);
  }

  async getLocale(userId: string): Promise<string> {
    return (await this.get(userId, 'locale') as string) ?? (USER_SETTING_DEFAULTS.locale as string);
  }

  async getTimezone(userId: string): Promise<string> {
    return (await this.get(userId, 'timezone') as string) ?? (USER_SETTING_DEFAULTS.timezone as string);
  }
}

export const userSettingsService = new UserSettingsService();
