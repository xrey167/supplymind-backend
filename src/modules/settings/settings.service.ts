import { userSettingsService } from './user-settings/user-settings.service';
import { workspaceSettingsService } from './workspace-settings/workspace-settings.service';

export const settingsService = {
  user: userSettingsService,
  workspace: workspaceSettingsService,
};
