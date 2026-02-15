import { sql } from '@vercel/postgres';
import { ensureSchema } from './schema';

let _schemaReady = false;

export async function getDb() {
  if (!_schemaReady) {
    await ensureSchema();
    _schemaReady = true;
  }
  return sql;
}

export { sql };
