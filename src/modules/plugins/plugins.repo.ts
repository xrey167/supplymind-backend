import { db } from '../../infra/db/client';
import { pluginInstallations } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { BaseRepo } from '../../infra/db/repositories/base.repo';

type Row = typeof pluginInstallations.$inferSelect;
type NewRow = typeof pluginInstallations.$inferInsert;

export interface PluginInstallationRow {
  id: string;
  pluginId: string;
  workspaceId: string;
  status: string;
}

const installationColumns = {
  id: pluginInstallations.id,
  pluginId: pluginInstallations.pluginId,
  workspaceId: pluginInstallations.workspaceId,
  status: pluginInstallations.status,
};

class PluginInstallationLiteRepository extends BaseRepo<typeof pluginInstallations, Row, NewRow> {
  constructor() { super(pluginInstallations); }

  async listEnabled(): Promise<PluginInstallationRow[]> {
    return db
      .select(installationColumns)
      .from(pluginInstallations)
      .where(eq(pluginInstallations.status, 'active'));
  }

  async findPluginInstallation(id: string): Promise<PluginInstallationRow | undefined> {
    const rows = await db
      .select(installationColumns)
      .from(pluginInstallations)
      .where(eq(pluginInstallations.id, id))
      .limit(1);
    return rows[0];
  }
}

export const pluginInstallationRepo = new PluginInstallationLiteRepository();
