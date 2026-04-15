import { and, eq } from 'drizzle-orm';
import type { AnyPgTable, PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../client';

/**
 * BaseRepo<TTable, TSelect, TInsert>
 *
 * A generic Drizzle-backed repository providing standard CRUD operations.
 * Concrete repos extend this class by passing the table reference and
 * optionally overriding methods for domain-specific logic.
 *
 * @typeParam TTable  - The Drizzle PgTable type (pass `typeof myTable`)
 * @typeParam TSelect - Row shape returned by SELECT (typically `typeof myTable.$inferSelect`)
 * @typeParam TInsert - Row shape accepted by INSERT (typically `typeof myTable.$inferInsert`)
 */
export abstract class BaseRepo<
  TTable extends AnyPgTable & { id: PgColumn },
  TSelect extends { id: string },
  TInsert extends Record<string, unknown>,
> {
  constructor(protected readonly table: TTable) {}

  /**
   * Find a single record by its primary key `id`.
   * Returns null when not found.
   */
  async findById(id: string): Promise<TSelect | null> {
    const rows = await (db as any)
      .select()
      .from(this.table)
      .where(eq((this.table as any).id, id))
      .limit(1);
    return (rows[0] as TSelect) ?? null;
  }

  /**
   * Return rows that match every key/value pair in `filters`.
   * Defaults to 500 rows; pass `limit: 0` to lift the cap (use carefully on large tables).
   */
  async findAll(filters?: Partial<TSelect>, limit = 500): Promise<TSelect[]> {
    let query = (db as any).select().from(this.table);

    if (filters) {
      const conditions = Object.entries(filters)
        .filter(([key, value]) => (this.table as any)[key] !== undefined && value !== undefined)
        .map(([key, value]) => eq((this.table as any)[key], value));
      if (conditions.length === 1) {
        query = query.where(conditions[0]);
      } else if (conditions.length > 1) {
        query = query.where(and(...conditions));
      }
    }

    if (limit > 0) query = query.limit(limit);

    return query as Promise<TSelect[]>;
  }

  /**
   * Insert a new row and return the inserted record.
   */
  async create(data: TInsert): Promise<TSelect> {
    const rows = await (db as any)
      .insert(this.table)
      .values(data)
      .returning();
    return rows[0] as TSelect;
  }

  /**
   * Update the row with the given `id` and return the updated record.
   * Returns null when the row does not exist.
   */
  async update(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
    const rows = await (db as any)
      .update(this.table)
      .set(data)
      .where(eq((this.table as any).id, id))
      .returning();
    return (rows[0] as TSelect) ?? null;
  }

  /**
   * Delete the row with the given `id`.
   * Returns `true` if a row was deleted, `false` if it did not exist.
   */
  async remove(id: string): Promise<boolean> {
    const rows = await (db as any)
      .delete(this.table)
      .where(eq((this.table as any).id, id))
      .returning({ id: (this.table as any).id });
    return rows.length > 0;
  }
}
