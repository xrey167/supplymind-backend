import { db } from '../../infra/db/client';
import { pluginCatalog } from '../../infra/db/schema';
import { and, eq } from 'drizzle-orm';
import { BaseRepo } from '../../infra/db/repositories/base.repo';
import type { CatalogRow, PluginManifestV1 } from './plugins.types';

type Row = typeof pluginCatalog.$inferSelect;
type NewRow = typeof pluginCatalog.$inferInsert;

class PluginCatalogRepository extends BaseRepo<typeof pluginCatalog, Row, NewRow> {
  constructor() { super(pluginCatalog); }

  async listAll(): Promise<CatalogRow[]> {
    return db.select().from(pluginCatalog) as unknown as Promise<CatalogRow[]>;
  }

  async findCatalogEntry(id: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog).where(eq(pluginCatalog.id, id)).limit(1);
    return row as unknown as CatalogRow | undefined;
  }

  async findByNameVersion(name: string, version: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog)
      .where(and(eq(pluginCatalog.name, name), eq(pluginCatalog.version, version)))
      .limit(1);
    return row as unknown as CatalogRow | undefined;
  }

  async registerPlugin(manifest: PluginManifestV1): Promise<CatalogRow> {
    const [row] = await db.insert(pluginCatalog).values({
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      capabilities: manifest.capabilities,
      requiredPermissions: manifest.requiredPermissions,
      manifest: manifest as unknown as Record<string, unknown>,
    }).returning();
    return row as unknown as CatalogRow;
  }
}

export const pluginCatalogRepo = new PluginCatalogRepository();
