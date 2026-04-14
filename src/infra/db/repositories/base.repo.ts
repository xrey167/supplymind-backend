import { eq } from 'drizzle-orm';
import { db } from '../client';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

/**
 * Generic base repository providing standard CRUD operations for Drizzle ORM tables.
 *
 * Type parameters:
 *   TTable  — the Drizzle PgTable instance
 *   TSelect — the inferred select type (must have an `id: string` field)
 *   TInsert — the inferred insert type
 *
 * Internally uses `any` to satisfy Drizzle's complex generic constraints while
 * exposing a fully-typed public API to consumers.
 */
export abstract class BaseRepo<
  TTable extends AnyPgTable,
  TSelect extends { id: string },
  TInsert extends object,
> {
  constructor(protected readonly table: TTable) {}

  /**
   * Find a single record by its primary key `id`.
   * Returns `null` when not found.
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
   * Return all records in the table (no filtering, no pagination).
   * Use sparingly — prefer domain-specific query methods on subclasses for large tables.
   */
  async findAll(): Promise<TSelect[]> {
    const rows = await (db as any).select().from(this.table);
    return rows as TSelect[];
  }

  /**
   * Insert a new record and return the created row.
   */
  async create(data: TInsert): Promise<TSelect> {
    const rows = await (db as any)
      .insert(this.table)
      .values(data)
      .returning();
    return rows[0] as TSelect;
  }

  /**
   * Update fields on a record identified by `id`.
   * Returns the updated row, or `null` if the record was not found.
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
   * Delete a record by `id`.
   * Returns `true` if a row was deleted, `false` if no matching row was found.
   */
  async remove(id: string): Promise<boolean> {
    const rows = await (db as any)
      .delete(this.table)
      .where(eq((this.table as any).id, id))
      .returning({ id: (this.table as any).id });
    return rows.length > 0;
  }
}
