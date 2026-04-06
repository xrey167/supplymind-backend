import { eq, and, isNull, lt } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaces, workspaceMembers } from '../../infra/db/schema';
import type { Workspace } from './workspaces.types';

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.createdBy,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
    deletedAt: row.deletedAt,
  };
}

class WorkspacesRepository {
  async create(input: { name: string; slug: string; createdBy: string }): Promise<Workspace> {
    const rows = await db.insert(workspaces).values({
      name: input.name,
      slug: input.slug,
      createdBy: input.createdBy,
    }).returning();
    return toWorkspace(rows[0]!);
  }

  async findById(id: string): Promise<Workspace | null> {
    const rows = await db.select().from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const rows = await db.select().from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<Workspace[]> {
    const rows = await db.select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdBy: workspaces.createdBy,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      deletedAt: workspaces.deletedAt,
    })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
    return rows.map(toWorkspace);
  }

  async update(id: string, input: { name?: string; slug?: string }): Promise<Workspace | null> {
    const rows = await db.update(workspaces)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning();
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async softDelete(id: string): Promise<void> {
    await db.update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  async restore(id: string): Promise<void> {
    await db.update(workspaces)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  async findSoftDeleted(olderThanDays: number): Promise<Workspace[]> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const rows = await db.select().from(workspaces).where(lt(workspaces.deletedAt, cutoff));
    return rows.map(toWorkspace);
  }

  async hardDelete(id: string): Promise<void> {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }

  async slugExists(slug: string): Promise<boolean> {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.slug, slug)).limit(1);
    return rows.length > 0;
  }
}

export const workspacesRepo = new WorkspacesRepository();
