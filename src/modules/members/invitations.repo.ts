import { eq, and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { workspaceInvitations } from '../../infra/db/schema';
import { nanoid } from 'nanoid';
import type { WorkspaceInvitation, WorkspaceRole } from './members.types';

export function hashToken(token: string): string {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(token);
  return hash.digest('hex');
}

function toInvitation(row: typeof workspaceInvitations.$inferSelect): WorkspaceInvitation {
  return {
    id: row.id, workspaceId: row.workspaceId, email: row.email,
    tokenHash: row.tokenHash, type: row.type as 'email' | 'link',
    role: row.role, invitedBy: row.invitedBy, expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt, createdAt: row.createdAt!,
  };
}

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

class InvitationsRepository {
  async create(workspaceId: string, input: {
    email?: string; type: 'email' | 'link'; role: WorkspaceRole;
    invitedBy: string; expiresAt?: Date;
  }): Promise<{ token: string; invitation: WorkspaceInvitation }> {
    const token = nanoid(32);
    const tokenHashValue = hashToken(token);
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MS);
    const rows = await db.insert(workspaceInvitations).values({
      workspaceId, email: input.email ?? null, tokenHash: tokenHashValue,
      type: input.type, role: input.role, invitedBy: input.invitedBy, expiresAt,
    }).returning();
    return { token, invitation: toInvitation(rows[0]!) };
  }

  async findByTokenHash(tokenHash: string): Promise<WorkspaceInvitation | null> {
    const now = new Date();
    const rows = await db.select().from(workspaceInvitations)
      .where(and(eq(workspaceInvitations.tokenHash, tokenHash), isNull(workspaceInvitations.acceptedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt < now) return null;
    return toInvitation(row);
  }

  async findByTokenHashForUpdate(tx: any, tokenHash: string): Promise<WorkspaceInvitation | null> {
    const now = new Date();
    const rows = await tx.execute(
      sql`SELECT * FROM workspace_invitations WHERE token_hash = ${tokenHash} AND accepted_at IS NULL FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at) < now) return null;
    return {
      id: row.id, workspaceId: row.workspace_id, email: row.email,
      tokenHash: row.token_hash, type: row.type as 'email' | 'link',
      role: row.role, invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  async findPendingByEmail(workspaceId: string, email: string): Promise<WorkspaceInvitation | null> {
    const now = new Date();
    const rows = await db.select().from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
      )).limit(1);
    const row = rows[0];
    if (!row || row.expiresAt < now) return null;
    return toInvitation(row);
  }

  async accept(id: string): Promise<void> {
    await db.update(workspaceInvitations).set({ acceptedAt: new Date() }).where(eq(workspaceInvitations.id, id));
  }

  async deleteExpired(): Promise<number> {
    const result = await db.delete(workspaceInvitations)
      .where(and(lt(workspaceInvitations.expiresAt, new Date()), isNull(workspaceInvitations.acceptedAt)))
      .returning({ id: workspaceInvitations.id });
    return result.length;
  }

  async deleteByWorkspace(workspaceId: string): Promise<void> {
    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId));
  }

  async listPending(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const rows = await db.select().from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        sql`${workspaceInvitations.expiresAt} >= now()`,
      ));
    return rows.map(toInvitation);
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, id));
  }

}
export const invitationsRepo = new InvitationsRepository();
