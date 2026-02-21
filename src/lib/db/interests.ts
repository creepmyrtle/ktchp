import { sql } from '@vercel/postgres';
import type { Interest } from '@/types';

export async function createInterest(
  userId: string,
  category: string,
  description: string | null = null,
  weight: number = 1.0
): Promise<Interest> {
  const { rows } = await sql`
    INSERT INTO interests (user_id, category, description, weight)
    VALUES (${userId}, ${category}, ${description}, ${weight})
    RETURNING *
  `;
  return rows[0] as Interest;
}

export async function getInterestsByUserId(userId: string): Promise<Interest[]> {
  const { rows } = await sql`SELECT * FROM interests WHERE user_id = ${userId} ORDER BY weight DESC`;
  return rows as Interest[];
}

export async function getActiveInterestsByUserId(userId: string): Promise<Interest[]> {
  const { rows } = await sql`
    SELECT * FROM interests WHERE user_id = ${userId} AND active = TRUE ORDER BY weight DESC
  `;
  return rows as Interest[];
}

export async function updateInterest(
  id: string,
  updates: Partial<Pick<Interest, 'category' | 'description' | 'weight' | 'active' | 'expanded_description'>>
): Promise<Interest | null> {
  if (updates.category !== undefined) {
    await sql`UPDATE interests SET category = ${updates.category} WHERE id = ${id}`;
  }
  if (updates.description !== undefined) {
    await sql`UPDATE interests SET description = ${updates.description} WHERE id = ${id}`;
  }
  if (updates.expanded_description !== undefined) {
    await sql`UPDATE interests SET expanded_description = ${updates.expanded_description} WHERE id = ${id}`;
  }
  if (updates.weight !== undefined) {
    await sql`UPDATE interests SET weight = ${updates.weight} WHERE id = ${id}`;
  }
  if (updates.active !== undefined) {
    await sql`UPDATE interests SET active = ${updates.active} WHERE id = ${id}`;
  }
  return getInterestById(id);
}

export async function getInterestById(id: string): Promise<Interest | null> {
  const { rows } = await sql`SELECT * FROM interests WHERE id = ${id}`;
  return (rows[0] as Interest) ?? null;
}

export async function deleteInterest(id: string): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM interests WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
