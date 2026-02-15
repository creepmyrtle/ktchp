import { sql } from '@vercel/postgres';
import type { Source } from '@/types';

export async function createSource(
  userId: string,
  name: string,
  type: string,
  config: Record<string, unknown>,
  enabled = true
): Promise<Source> {
  const { rows } = await sql`
    INSERT INTO sources (user_id, name, type, config, enabled)
    VALUES (${userId}, ${name}, ${type}, ${JSON.stringify(config)}, ${enabled})
    RETURNING *
  `;
  const row = rows[0];
  return { ...row, config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config } as Source;
}

export async function getSourcesByUserId(userId: string): Promise<Source[]> {
  const { rows } = await sql`SELECT * FROM sources WHERE user_id = ${userId}`;
  return rows.map(r => ({
    ...r,
    config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
  })) as Source[];
}

export async function getEnabledSourcesByUserId(userId: string): Promise<Source[]> {
  const { rows } = await sql`SELECT * FROM sources WHERE user_id = ${userId} AND enabled = TRUE`;
  return rows.map(r => ({
    ...r,
    config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
  })) as Source[];
}

export async function getSourceById(id: string): Promise<Source | null> {
  const { rows } = await sql`SELECT * FROM sources WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...row, config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config } as Source;
}

export async function updateSource(id: string, updates: Partial<Pick<Source, 'name' | 'type' | 'config' | 'enabled'>>): Promise<Source | null> {
  if (updates.name !== undefined) {
    await sql`UPDATE sources SET name = ${updates.name} WHERE id = ${id}`;
  }
  if (updates.type !== undefined) {
    await sql`UPDATE sources SET type = ${updates.type} WHERE id = ${id}`;
  }
  if (updates.config !== undefined) {
    await sql`UPDATE sources SET config = ${JSON.stringify(updates.config)} WHERE id = ${id}`;
  }
  if (updates.enabled !== undefined) {
    await sql`UPDATE sources SET enabled = ${updates.enabled} WHERE id = ${id}`;
  }
  return getSourceById(id);
}

export async function deleteSource(id: string): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM sources WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
