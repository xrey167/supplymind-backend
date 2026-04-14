import { db } from '../../infra/db/client';
import { pluginInstallations, pluginEvents, auditLogs } from '../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { InstallationRow, PluginEventRow, PluginStatus, PluginEventType, Actor } from './plugins.types';
import { VALID_TRANSITIONS } from './plugins.types';

export const pluginInstallationRepo = {
  async findByWorkspace(workspaceId: string): Promise<InstallationRow[]> {
    return db.select().from(pluginInstallations)
      .where(eq(pluginInstallations.workspaceId, workspaceId)) as unknown as Promise<InstallationRow[]>;
  },

  async findById(id: string): Promise<InstallationRow | undefined> {
    const [row] = await db.select().from(pluginInstallations)
      .where(eq(pluginInstallations.id, id)).limit(1);
    return row as unknown as InstallationRow | undefined;
  },

  async findByWorkspaceAndPlugin(workspaceId: string, pluginId: string): Promise<InstallationRow | undefined> {
    const [row] = await db.select().from(pluginInstallations)
      .where(and(
        eq(pluginInstallations.workspaceId, workspaceId),
        eq(pluginInstallations.pluginId, pluginId),
      )).limit(1);
    return row as unknown as InstallationRow | undefined;
  },

  async listEnabled(): Promise<InstallationRow[]> {
    return db.select().from(pluginInstallations)
      .where(eq(pluginInstallations.status, 'active')) as unknown as Promise<InstallationRow[]>;
  },

  /**
   * Write event + update projected status in one transaction.
   * This is the only way status is changed — never update status directly.
   */
  async transition(
    installationId: string,
    workspaceId: string,
    newStatus: PluginStatus,
    eventType: PluginEventType,
    actor: Actor,
    payload: Record<string, unknown> = {},
    extraUpdates: Partial<{
      config: Record<string, unknown>;
      pinnedVersion: string;
      policyBinding: Record<string, unknown>;
    }> = {},
  ): Promise<{ installation: InstallationRow; event: PluginEventRow }> {
    return db.transaction(async (tx) => {
      // Enforce valid state transition before writing
      const [current] = await tx.select({ status: pluginInstallations.status })
        .from(pluginInstallations)
        .where(eq(pluginInstallations.id, installationId))
        .limit(1);
      if (current) {
        const allowed = VALID_TRANSITIONS[current.status as PluginStatus] ?? [];
        if (!allowed.includes(newStatus)) {
          throw new Error(`Invalid plugin status transition: ${current.status} → ${newStatus}`);
        }
      }

      const [event] = await tx.insert(pluginEvents).values({
        installationId,
        workspaceId,
        eventType,
        actorId: actor.id,
        actorType: actor.type,
        payload,
      }).returning();
      if (!event) throw new Error('Plugin event insert returned no rows');

      const [installation] = await tx.update(pluginInstallations)
        .set({
          status: newStatus,
          updatedAt: new Date(),
          ...(extraUpdates.config && { config: extraUpdates.config }),
          ...(extraUpdates.pinnedVersion && { pinnedVersion: extraUpdates.pinnedVersion }),
          ...(extraUpdates.policyBinding && { policyBinding: extraUpdates.policyBinding }),
        })
        .where(eq(pluginInstallations.id, installationId))
        .returning();
      if (!installation) throw new Error('Plugin installation update returned no rows');

      await tx.insert(auditLogs).values({
        workspaceId,
        actorId: actor.id,
        actorType: actor.type,
        action: `plugin.${eventType}`,
        resourceType: 'plugin_installation',
        resourceId: installationId,
        metadata: payload,
      });

      return {
        installation: installation as unknown as InstallationRow,
        event: event as unknown as PluginEventRow,
      };
    });
  },

  async create(data: {
    workspaceId: string;
    pluginId: string;
    config?: Record<string, unknown>;
  }): Promise<InstallationRow> {
    const [row] = await db.insert(pluginInstallations).values({
      workspaceId: data.workspaceId,
      pluginId: data.pluginId,
      status: 'installing',
      config: data.config ?? {},
    }).returning();
    if (!row) throw new Error('Plugin installation insert returned no rows');
    return row as unknown as InstallationRow;
  },

  async getEvents(installationId: string, limit = 50): Promise<PluginEventRow[]> {
    return db.select().from(pluginEvents)
      .where(eq(pluginEvents.installationId, installationId))
      .orderBy(desc(pluginEvents.createdAt))
      .limit(limit) as unknown as Promise<PluginEventRow[]>;
  },

  async updateSecretBindingIds(installationId: string, secretBindingIds: string[]): Promise<void> {
    await db.update(pluginInstallations)
      .set({ secretBindingIds, updatedAt: new Date() })
      .where(eq(pluginInstallations.id, installationId));
  },

  async getLastVersionPinnedEvent(installationId: string): Promise<PluginEventRow | undefined> {
    const [row] = await db.select().from(pluginEvents)
      .where(and(
        eq(pluginEvents.installationId, installationId),
        eq(pluginEvents.eventType, 'version_pinned'),
      ))
      .orderBy(desc(pluginEvents.createdAt))
      .limit(1);
    return row as unknown as PluginEventRow | undefined;
  },
};
