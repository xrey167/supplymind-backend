import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = Bun.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client);

export async function closeDb(): Promise<void> {
  await client.end();
}
