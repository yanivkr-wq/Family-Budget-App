import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL_DIRECT or DATABASE_URL must be set for drizzle-kit');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
