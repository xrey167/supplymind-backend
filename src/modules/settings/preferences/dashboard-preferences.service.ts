import { userSettingsService } from '../user-settings/user-settings.service';

export const dashboardPreferencesService = {
  async getLayout(userId: string): Promise<string> {
    return (await userSettingsService.get(userId, 'dashboard_layout') as string) ?? 'default';
  },

  async setLayout(userId: string, layout: string): Promise<void> {
    await userSettingsService.set(userId, 'dashboard_layout', layout);
  },

  async getPinnedAgents(userId: string): Promise<string[]> {
    return (await userSettingsService.get(userId, 'dashboard_pinned_agents') as string[]) ?? [];
  },

  async setPinnedAgents(userId: string, agentIds: string[]): Promise<void> {
    await userSettingsService.set(userId, 'dashboard_pinned_agents', agentIds);
  },
};
