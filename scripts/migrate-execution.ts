import postgres from 'postgres';
import { readFileSync } from 'fs';

const client = postgres(Bun.env.DATABASE_URL!);

const sql = readFileSync('./drizzle/0007_execution_layer.sql', 'utf-8');
const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

for (const stmt of statements) {
  try {
    await client.unsafe(stmt);
    console.log('OK:', stmt.slice(0, 60));
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('SKIP (already exists):', stmt.slice(0, 60));
    } else {
      console.error('ERROR:', e.message, '\nSTMT:', stmt.slice(0, 100));
    }
  }
}

await client.end();
console.log('Migration complete');
