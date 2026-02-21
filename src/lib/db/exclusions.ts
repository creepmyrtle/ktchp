import { sql } from '@vercel/postgres';
import type { Exclusion } from '@/types';

export async function createExclusion(
  userId: string,
  category: string,
  description: string | null = null
): Promise<Exclusion> {
  const { rows } = await sql`
    INSERT INTO exclusions (user_id, category, description)
    VALUES (${userId}, ${category}, ${description})
    RETURNING *
  `;
  return rows[0] as Exclusion;
}

export async function getExclusionsByUserId(userId: string): Promise<Exclusion[]> {
  const { rows } = await sql`
    SELECT * FROM exclusions WHERE user_id = ${userId} ORDER BY created_at DESC
  `;
  return rows as Exclusion[];
}

export async function getExclusionById(id: string): Promise<Exclusion | null> {
  const { rows } = await sql`SELECT * FROM exclusions WHERE id = ${id}`;
  return (rows[0] as Exclusion) ?? null;
}

export async function updateExclusion(
  id: string,
  updates: Partial<Pick<Exclusion, 'category' | 'description' | 'expanded_description'>>
): Promise<Exclusion | null> {
  if (updates.category !== undefined) {
    await sql`UPDATE exclusions SET category = ${updates.category} WHERE id = ${id}`;
  }
  if (updates.description !== undefined) {
    await sql`UPDATE exclusions SET description = ${updates.description} WHERE id = ${id}`;
  }
  if (updates.expanded_description !== undefined) {
    await sql`UPDATE exclusions SET expanded_description = ${updates.expanded_description} WHERE id = ${id}`;
  }
  return getExclusionById(id);
}

export async function deleteExclusion(id: string): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM exclusions WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
