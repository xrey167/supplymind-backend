import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infra/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: (Bun.env.DATABASE_URL ?? process.env.DATABASE_URL)! },
});
