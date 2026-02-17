import { sql } from '@vercel/postgres';
import type { Source, UserSourceSetting } from '@/types';

function parseSource(row: Record<string, unknown>): Source {
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config as string) : row.config,
  } as Source;
}

export async function createSource(
  userId: string,
  name: string,
  type: string,
  config: Record<string, unknown>,
  enabled = true,
  isDefault = false
): Promise<Source> {
  const { rows } = await sql`
    INSERT INTO sources (user_id, name, type, config, enabled, is_default, created_by)
    VALUES (${userId}, ${name}, ${type}, ${JSON.stringify(config)}, ${enabled}, ${isDefault}, ${userId})
    RETURNING *
  `;
  return parseSource(rows[0]);
}

// Get all sources visible to user: defaults + their own private sources
export async function getSourcesForUser(userId: string): Promise<(Source & { user_enabled?: boolean })[]> {
  // Get default sources with user's opt-in/out state
  const { rows: defaultRows } = await sql`
    SELECT s.*, uss.enabled as user_enabled
    FROM sources s
    LEFT JOIN user_source_settings uss ON uss.source_id = s.id AND uss.user_id = ${userId}
    WHERE s.is_default = TRUE
    ORDER BY s.name
  `;
  // Get user's own private (non-default) sources
  const { rows: privateRows } = await sql`
    SELECT s.*, NULL as user_enabled
    FROM sources s
    WHERE s.user_id = ${userId} AND s.is_default = FALSE
    ORDER BY s.name
  `;
  return [...defaultRows, ...privateRows].map(r => ({
    ...parseSource(r),
    user_enabled: r.user_enabled,
  }));
}

// Get enabled sources for a user (for ingestion scoring)
export async function getEnabledSourcesForUser(userId: string): Promise<Source[]> {
  // Default sources not opted-out
  const { rows: defaultRows } = await sql`
    SELECT s.*
    FROM sources s
    WHERE s.is_default = TRUE AND s.enabled = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM user_source_settings uss
        WHERE uss.source_id = s.id AND uss.user_id = ${userId} AND uss.enabled = FALSE
      )
  `;
  // User's own enabled private sources
  const { rows: privateRows } = await sql`
    SELECT s.*
    FROM sources s
    WHERE s.user_id = ${userId} AND s.is_default = FALSE AND s.enabled = TRUE
  `;
  return [...defaultRows, ...privateRows].map(parseSource);
}

// All fetchable sources across all users (for ingestion)
export async function getAllFetchableSources(): Promise<Source[]> {
  const { rows } = await sql`
    SELECT DISTINCT s.*
    FROM sources s
    WHERE s.enabled = TRUE
      AND (
        s.is_default = TRUE
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.is_active = TRUE)
      )
  `;
  return rows.map(parseSource);
}

export async function getSourceById(id: string): Promise<Source | null> {
  const { rows } = await sql`SELECT * FROM sources WHERE id = ${id}`;
  if (rows.length === 0) return null;
  return parseSource(rows[0]);
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
  // Must delete in dependency order: user_articles → feedback → embeddings → articles → source
  const articleIds = await sql`SELECT id FROM articles WHERE source_id = ${id}`;
  if (articleIds.rows.length > 0) {
    const ids = articleIds.rows.map(r => r.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await sql.query(`DELETE FROM user_articles WHERE article_id IN (${placeholders})`, ids);
    await sql.query(`DELETE FROM feedback WHERE article_id IN (${placeholders})`, ids);
    await sql.query(`DELETE FROM embeddings WHERE ref_type = 'article' AND ref_id IN (${placeholders})`, ids);
    await sql.query(`DELETE FROM articles WHERE source_id = $1`, [id]);
  }
  await sql`DELETE FROM user_source_settings WHERE source_id = ${id}`;
  const { rowCount } = await sql`DELETE FROM sources WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

// User source settings (enable/disable default sources per user)
export async function getUserSourceSetting(userId: string, sourceId: string): Promise<UserSourceSetting | null> {
  const { rows } = await sql`
    SELECT * FROM user_source_settings WHERE user_id = ${userId} AND source_id = ${sourceId}
  `;
  return (rows[0] as UserSourceSetting) ?? null;
}

export async function setUserSourceSetting(userId: string, sourceId: string, enabled: boolean): Promise<void> {
  await sql`
    INSERT INTO user_source_settings (user_id, source_id, enabled)
    VALUES (${userId}, ${sourceId}, ${enabled})
    ON CONFLICT (user_id, source_id) DO UPDATE SET enabled = ${enabled}
  `;
}

// Legacy — used by old routes. Kept for backward-compat during migration.
export async function getSourcesByUserId(userId: string): Promise<Source[]> {
  return getSourcesForUser(userId);
}

export async function getEnabledSourcesByUserId(userId: string): Promise<Source[]> {
  return getEnabledSourcesForUser(userId);
}
