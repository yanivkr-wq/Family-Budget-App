import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closeDb, getDb } from './client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_DIRECT or DATABASE_URL must be set');

  const db = getDb(url);
  const migrationsFolder = path.join(__dirname, '..', 'drizzle');
  console.log(`Running migrations from ${migrationsFolder} ...`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');
  await closeDb();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
