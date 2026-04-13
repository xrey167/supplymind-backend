/**
 * Run with: bun --env-file .env.development run scripts/diagnose-migration.ts
 * Executes each statement in 0010_sad_tarot.sql individually and prints the first error.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = postgres(process.env.DATABASE_URL!, { connect_timeout: 10 });

// Check applied migrations
const applied = await sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`;
console.log('\n=== Applied migrations ===');
applied.forEach(r => console.log(' -', r.hash));

// Split the migration file on statement-breakpoints
const migrationPath = join(import.meta.dir, '..', 'drizzle', '0010_sad_tarot.sql');
const content = readFileSync(migrationPath, 'utf-8');
const statements = content.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

console.log(`\n=== Running ${statements.length} statements ===\n`);

let failed = 0;
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i]!;
  const preview = stmt.slice(0, 80).replace(/\n/g, ' ');
  try {
    await sql.unsafe(stmt);
    console.log(`[OK ] ${i + 1}/${statements.length}: ${preview}`);
  } catch (e: any) {
    console.error(`[ERR] ${i + 1}/${statements.length}: ${preview}`);
    console.error(`      → ${e.message}`);
    failed++;
    if (failed >= 3) {
      console.error('\nStopped after 3 errors.');
      break;
    }
  }
}

await sql.end({ timeout: 2 });
console.log('\nDone.');
