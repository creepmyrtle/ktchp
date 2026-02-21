import { sql } from '@vercel/postgres';
import type { InterestSuggestion } from '@/types';

export async function createSuggestion(
  userId: string,
  category: string,
  description: string | null,
  relatedInterests: string[],
  reasoning: string | null,
  confidence: number
): Promise<InterestSuggestion> {
  const { rows } = await sql`
    INSERT INTO interest_suggestions (user_id, category, description, related_interests, reasoning, confidence)
    VALUES (${userId}, ${category}, ${description}, ${JSON.stringify(relatedInterests)}, ${reasoning}, ${confidence})
    RETURNING *
  `;
  const row = rows[0];
  return { ...row, related_interests: row.related_interests || [] } as InterestSuggestion;
}

export async function getPendingSuggestions(userId: string): Promise<InterestSuggestion[]> {
  const { rows } = await sql`
    SELECT * FROM interest_suggestions
    WHERE user_id = ${userId} AND status = 'pending'
    ORDER BY confidence DESC
  `;
  return rows.map(r => ({ ...r, related_interests: r.related_interests || [] })) as InterestSuggestion[];
}

export async function getDismissedCategories(userId: string): Promise<string[]> {
  const { rows } = await sql`
    SELECT category FROM interest_suggestions
    WHERE user_id = ${userId} AND status = 'dismissed'
  `;
  return rows.map(r => r.category);
}

export async function getSuggestionById(id: string): Promise<InterestSuggestion | null> {
  const { rows } = await sql`SELECT * FROM interest_suggestions WHERE id = ${id}`;
  if (!rows[0]) return null;
  return { ...rows[0], related_interests: rows[0].related_interests || [] } as InterestSuggestion;
}

export async function acceptSuggestion(id: string): Promise<void> {
  await sql`
    UPDATE interest_suggestions SET status = 'accepted', resolved_at = NOW()
    WHERE id = ${id}
  `;
}

export async function dismissSuggestion(id: string): Promise<void> {
  await sql`
    UPDATE interest_suggestions SET status = 'dismissed', resolved_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getPendingSuggestionCount(userId: string): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*) as count FROM interest_suggestions
    WHERE user_id = ${userId} AND status = 'pending'
  `;
  return parseInt(rows[0].count, 10);
}
