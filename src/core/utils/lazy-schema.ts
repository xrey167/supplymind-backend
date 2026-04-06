/**
 * Defers Zod schema construction until first use.
 * Prevents top-level module-init cost for schemas that may never be called.
 *
 * Usage:
 *   export const mySchema = lazySchema(() => z.object({ ... }));
 *   // Call as: mySchema().parse(input)
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined;
  return () => (cached ??= factory());
}
