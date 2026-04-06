import { userSettingsService } from '../user-settings/user-settings.service';

export const notificationPreferencesService = {
  async getEmailEnabled(userId: string): Promise<boolean> {
    return (await userSettingsService.get(userId, 'notifications_email') as boolean) ?? true;
  },

  async setEmailEnabled(userId: string, enabled: boolean): Promise<void> {
    await userSettingsService.set(userId, 'notifications_email', enabled);
  },

  async getPushEnabled(userId: string): Promise<boolean> {
    return (await userSettingsService.get(userId, 'notifications_push') as boolean) ?? true;
  },

  async setPushEnabled(userId: string, enabled: boolean): Promise<void> {
    await userSettingsService.set(userId, 'notifications_push', enabled);
  },
};
