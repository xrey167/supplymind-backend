/**
 * Runs all drizzle migrations directly via docker exec (psql inside the container).
 * Use when localhost port forwarding isn't working:
 *   bun scripts/run-migrations-via-docker.ts
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync, spawnSync } from 'child_process';

const CONTAINER = 'backend-postgres-1';
const PG_USER = 'supplymind';
const PG_DB = 'supplymind_dev';
const DRIZZLE_DIR = join(import.meta.dir, '..', 'drizzle');
const JOURNAL_PATH = join(DRIZZLE_DIR, 'meta', '_journal.json');

// --- helpers ----------------------------------------------------------------

function psql(sql: string): { ok: boolean; output: string } {
  const result = spawnSync('docker', [
    'exec', '-i', CONTAINER,
    'psql', '-U', PG_USER, '-d', PG_DB,
    '-v', 'ON_ERROR_STOP=1',
    '-c', sql,
  ], { encoding: 'utf-8' });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  return { ok: result.status === 0, output };
}

function psqlFile(sql: string): { ok: boolean; output: string } {
  // Pipe SQL text to psql via stdin
  const result = spawnSync('docker', [
    'exec', '-i', CONTAINER,
    'psql', '-U', PG_USER, '-d', PG_DB,
    '-v', 'ON_ERROR_STOP=0',  // we handle errors per-statement ourselves
  ], { input: sql, encoding: 'utf-8' });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  return { ok: result.status === 0, output };
}

// --- ensure drizzle migrations table exists ---------------------------------

console.log('Ensuring drizzle migrations table exists...');
psql(`
  CREATE SCHEMA IF NOT EXISTS drizzle;
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at BIGINT
  );
`);

// --- get already-applied migrations -----------------------------------------

const appliedResult = spawnSync('docker', [
  'exec', '-i', CONTAINER,
  'psql', '-U', PG_USER, '-d', PG_DB,
  '-t', '-A', '-c', 'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at',
], { encoding: 'utf-8' });

const applied = new Set(
  (appliedResult.stdout ?? '').split('\n').map(s => s.trim()).filter(Boolean)
);
console.log(`Already applied: ${applied.size} migrations`);
if (applied.size > 0) console.log(' -', [...applied].join('\n - '));

// --- load journal and run missing migrations --------------------------------

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
let ran = 0;
let failed = 0;

for (const entry of journal.entries) {
  const tag = entry.tag as string;
  const when = entry.when as number;

  if (applied.has(tag)) {
    console.log(`[SKIP] ${tag} (already applied)`);
    continue;
  }

  const sqlPath = join(DRIZZLE_DIR, `${tag}.sql`);
  if (!existsSync(sqlPath)) {
    console.error(`[MISS] ${tag} — file not found: ${sqlPath}`);
    failed++;
    continue;
  }

  const rawSql = readFileSync(sqlPath, 'utf-8');
  // Split on drizzle breakpoints
  const statements = rawSql
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(Boolean);

  console.log(`\n[RUN ] ${tag} (${statements.length} statements)`);

  let stmtFailed = false;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const preview = stmt.slice(0, 70).replace(/\n/g, ' ');
    const r = psqlFile(stmt);
    if (r.output.includes('ERROR') && !r.output.includes('already exists') && !r.output.includes('does not exist')) {
      console.error(`  [ERR] stmt ${i + 1}: ${preview}`);
      console.error(`        ${r.output.trim().split('\n').slice(0, 3).join(' | ')}`);
      stmtFailed = true;
    } else {
      console.log(`  [OK ] stmt ${i + 1}: ${preview}`);
    }
  }

  if (!stmtFailed) {
    // Record migration as applied
    const record = psql(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${tag}', ${when}) ON CONFLICT DO NOTHING`
    );
    if (record.ok) {
      console.log(`  [REC] recorded as applied`);
      ran++;
    } else {
      console.error(`  [ERR] failed to record migration: ${record.output}`);
    }
  } else {
    console.error(`  [FAIL] ${tag} had errors — not recorded`);
    failed++;
  }
}

console.log(`\n=== Done: ${ran} applied, ${failed} failed ===`);
if (failed > 0) process.exit(1);
