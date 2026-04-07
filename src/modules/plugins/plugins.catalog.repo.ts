import { db } from '../../infra/db/client';
import { pluginCatalog } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import type { CatalogRow, PluginManifestV1 } from './plugins.types';

export const pluginCatalogRepo = {
  async findAll(): Promise<CatalogRow[]> {
    return db.select().from(pluginCatalog) as unknown as Promise<CatalogRow[]>;
  },

  async findById(id: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog).where(eq(pluginCatalog.id, id)).limit(1);
    return row as unknown as CatalogRow | undefined;
  },

  async findByNameVersion(name: string, version: string): Promise<CatalogRow | undefined> {
    const [row] = await db.select().from(pluginCatalog)
      .where(eq(pluginCatalog.name, name))
      .limit(1);
    return row as unknown as CatalogRow | undefined;
  },

  async create(manifest: PluginManifestV1): Promise<CatalogRow> {
    const [row] = await db.insert(pluginCatalog).values({
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      capabilities: manifest.capabilities,
      requiredPermissions: manifest.requiredPermissions,
      manifest: manifest as unknown as Record<string, unknown>,
    }).returning();
    return row as unknown as CatalogRow;
  },
};
