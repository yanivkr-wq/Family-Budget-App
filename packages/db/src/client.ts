import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

let _client: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb(databaseUrl?: string) {
  if (_db) return _db;

  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  _client = postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 30,
    prepare: false,
  });
  _db = drizzle(_client, { schema, casing: 'snake_case' });
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = undefined;
    _db = undefined;
  }
}

export type Database = ReturnType<typeof getDb>;
