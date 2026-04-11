import { db } from '../../infra/db/client';
import { pluginInstallations } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';

export interface PluginInstallationRow {
  id: string;
  pluginId: string;
  workspaceId: string;
  enabled: boolean;
}

const installationColumns = {
  id: pluginInstallations.id,
  pluginId: pluginInstallations.pluginId,
  workspaceId: pluginInstallations.workspaceId,
  enabled: pluginInstallations.enabled,
};

export const pluginInstallationRepo = {
  async listEnabled(): Promise<PluginInstallationRow[]> {
    return db
      .select(installationColumns)
      .from(pluginInstallations)
      .where(eq(pluginInstallations.enabled, true));
  },

  async findById(id: string): Promise<PluginInstallationRow | undefined> {
    const rows = await db
      .select(installationColumns)
      .from(pluginInstallations)
      .where(eq(pluginInstallations.id, id))
      .limit(1);
    return rows[0];
  },
};
