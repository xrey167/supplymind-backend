import { eq, and } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { credentials } from '../../infra/db/schema';
import type { Credential, CredentialProvider, CredentialRow } from './credentials.types';

function toCredential(row: any): Credential {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    provider: row.provider,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCredentialRow(row: any): CredentialRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    provider: row.provider,
    encryptedValue: row.encryptedValue,
    iv: row.iv,
    tag: row.tag,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class CredentialsRepository {
  async create(input: {
    workspaceId: string;
    name: string;
    provider: string;
    encryptedValue: string;
    iv: string;
    tag: string;
    metadata: Record<string, unknown>;
  }): Promise<Credential> {
    const rows = await db.insert(credentials).values({
      workspaceId: input.workspaceId,
      name: input.name,
      provider: input.provider as any,
      encryptedValue: input.encryptedValue,
      iv: input.iv,
      tag: input.tag,
      metadata: input.metadata,
    }).returning();
    return toCredential(rows[0]!);
  }

  async findById(id: string): Promise<CredentialRow | null> {
    const rows = await db.select().from(credentials).where(eq(credentials.id, id));
    return rows[0] ? toCredentialRow(rows[0]) : null;
  }

  async list(workspaceId: string): Promise<Credential[]> {
    const rows = await db.select().from(credentials).where(eq(credentials.workspaceId, workspaceId));
    return rows.map(toCredential);
  }

  async update(id: string, data: Partial<{
    name: string;
    encryptedValue: string;
    iv: string;
    tag: string;
    metadata: Record<string, unknown>;
  }>): Promise<Credential | null> {
    const rows = await db.update(credentials)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(credentials.id, id))
      .returning();
    return rows[0] ? toCredential(rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const rows = await db.delete(credentials).where(eq(credentials.id, id)).returning();
    return rows.length > 0;
  }

  async findByProvider(workspaceId: string, provider: CredentialProvider): Promise<CredentialRow | null> {
    const rows = await db.select().from(credentials)
      .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.provider, provider as any)))
      .limit(1);
    return rows[0] ? toCredentialRow(rows[0]) : null;
  }
}

export const credentialsRepo = new CredentialsRepository();
