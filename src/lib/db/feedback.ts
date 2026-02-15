import { sql } from '@vercel/postgres';
import type { Feedback, FeedbackAction } from '@/types';

export async function createFeedback(userId: string, articleId: string, action: FeedbackAction): Promise<Feedback | null> {
  try {
    const { rows } = await sql`
      INSERT INTO feedback (user_id, article_id, action)
      VALUES (${userId}, ${articleId}, ${action})
      RETURNING *
    `;
    return rows[0] as Feedback;
  } catch (e: unknown) {
    if (e instanceof Error && (e.message.includes('unique') || e.message.includes('duplicate'))) return null;
    throw e;
  }
}

export async function getFeedbackForArticle(userId: string, articleId: string): Promise<Feedback[]> {
  const { rows } = await sql`
    SELECT * FROM feedback WHERE user_id = ${userId} AND article_id = ${articleId}
  `;
  return rows as Feedback[];
}

export async function getFeedbackByUserId(userId: string, limit: number = 50): Promise<Feedback[]> {
  const { rows } = await sql`
    SELECT * FROM feedback WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as Feedback[];
}

export async function getFeedbackCount(userId: string): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*) as count FROM feedback WHERE user_id = ${userId}
  `;
  return parseInt(rows[0].count, 10);
}

export async function getRecentFeedbackWithArticles(userId: string, limit: number = 50) {
  const { rows } = await sql`
    SELECT f.*, a.title, a.url, a.relevance_reason, s.name as source_name
    FROM feedback f
    JOIN articles a ON f.article_id = a.id
    JOIN sources s ON a.source_id = s.id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function getBookmarkedArticles(userId: string) {
  const { rows } = await sql`
    SELECT a.*, s.name as source_name, s.type as source_type
    FROM feedback f
    JOIN articles a ON f.article_id = a.id
    JOIN sources s ON a.source_id = s.id
    WHERE f.user_id = ${userId} AND f.action = 'bookmark'
    ORDER BY f.created_at DESC
  `;
  return rows;
}

export async function deleteFeedback(userId: string, articleId: string, action: FeedbackAction): Promise<boolean> {
  const { rowCount } = await sql`
    DELETE FROM feedback WHERE user_id = ${userId} AND article_id = ${articleId} AND action = ${action}
  `;
  return (rowCount ?? 0) > 0;
}
