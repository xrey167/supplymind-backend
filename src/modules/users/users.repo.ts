import { eq } from 'drizzle-orm';
import { db } from '../../infra/db/client';
import { users } from '../../infra/db/schema';
import type { User } from './users.types';

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
  };
}

class UsersRepository {
  async upsert(input: { id: string; email: string; name?: string | null; avatarUrl?: string | null }): Promise<User> {
    const rows = await db.insert(users).values({
      id: input.id,
      email: input.email,
      name: input.name ?? null,
      avatarUrl: input.avatarUrl ?? null,
    }).onConflictDoUpdate({
      target: users.id,
      set: {
        email: input.email,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        updatedAt: new Date(),
      },
    }).returning();
    return toUser(rows[0]!);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async updateLastSeen(id: string): Promise<void> {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}

export const usersRepo = new UsersRepository();
