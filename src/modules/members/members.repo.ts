import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaceMembers, users } from '../../infra/db/schema';
import type { WorkspaceMember, MemberWithUser, WorkspaceRole } from './members.types';

function toMember(row: typeof workspaceMembers.$inferSelect): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    invitedBy: row.invitedBy,
    joinedAt: row.joinedAt!,
  };
}

class MembersRepository {
  async addMember(workspaceId: string, userId: string, role: WorkspaceRole, invitedBy?: string): Promise<WorkspaceMember> {
    const rows = await db.insert(workspaceMembers).values({
      workspaceId, userId, role, invitedBy: invitedBy ?? null,
    }).returning();
    return toMember(rows[0]!);
  }

  async findMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const rows = await db.select().from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    return rows[0] ? toMember(rows[0]) : null;
  }

  async listMembers(workspaceId: string): Promise<MemberWithUser[]> {
    const rows = await db.select({
      id: workspaceMembers.id, workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId, role: workspaceMembers.role,
      invitedBy: workspaceMembers.invitedBy, joinedAt: workspaceMembers.joinedAt,
      userName: users.name, userEmail: users.email, userAvatarUrl: users.avatarUrl,
    })
      .from(workspaceMembers)
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    return rows.map((r) => ({
      id: r.id, workspaceId: r.workspaceId, userId: r.userId,
      role: r.role, invitedBy: r.invitedBy, joinedAt: r.joinedAt!,
      userName: r.userName, userEmail: r.userEmail, userAvatarUrl: r.userAvatarUrl,
    }));
  }

  async updateRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember | null> {
    const rows = await db.update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning();
    return rows[0] ? toMember(rows[0]) : null;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await db.delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  async countOwners(workspaceId: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));
    return result?.count ?? 0;
  }

  async findByUserId(userId: string): Promise<WorkspaceMember[]> {
    const rows = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
    return rows.map(toMember);
  }
}

export const membersRepo = new MembersRepository();
