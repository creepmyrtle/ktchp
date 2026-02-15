import { sql } from '@vercel/postgres';
import type { LearnedPreference } from '@/types';

export async function createPreference(
  userId: string,
  text: string,
  derivedFromCount: number,
  confidence: number
): Promise<LearnedPreference> {
  const { rows } = await sql`
    INSERT INTO learned_preferences (user_id, preference_text, derived_from_count, confidence)
    VALUES (${userId}, ${text}, ${derivedFromCount}, ${confidence})
    RETURNING *
  `;
  return rows[0] as LearnedPreference;
}

export async function getPreferencesByUserId(userId: string): Promise<LearnedPreference[]> {
  const { rows } = await sql`
    SELECT * FROM learned_preferences WHERE user_id = ${userId} ORDER BY confidence DESC
  `;
  return rows as LearnedPreference[];
}

export async function updatePreference(
  id: string,
  text: string,
  derivedFromCount: number,
  confidence: number
): Promise<void> {
  await sql`
    UPDATE learned_preferences
    SET preference_text = ${text}, derived_from_count = ${derivedFromCount}, confidence = ${confidence}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deletePreference(id: string): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM learned_preferences WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

export async function clearPreferences(userId: string): Promise<void> {
  await sql`DELETE FROM learned_preferences WHERE user_id = ${userId}`;
}
