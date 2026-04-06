import { userSettingsService } from '../user-settings/user-settings.service';

export const aiPreferencesService = {
  async getDefaultModel(userId: string): Promise<string> {
    return (await userSettingsService.get(userId, 'ai_default_model') as string) ?? 'claude-sonnet-4-6';
  },

  async getDefaultTemperature(userId: string): Promise<number> {
    return (await userSettingsService.get(userId, 'ai_default_temperature') as number) ?? 0.7;
  },

  async setDefaultModel(userId: string, model: string): Promise<void> {
    await userSettingsService.set(userId, 'ai_default_model', model);
  },

  async setDefaultTemperature(userId: string, temp: number): Promise<void> {
    await userSettingsService.set(userId, 'ai_default_temperature', temp);
  },
};
