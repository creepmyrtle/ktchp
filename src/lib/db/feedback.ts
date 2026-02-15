import { sql } from '@vercel/postgres';
import type { Feedback, FeedbackAction, ArticleWithSource } from '@/types';

/**
 * Append a feedback event to the log. This is a pure event log —
 * every action creates a new row, no upserts or deletes.
 */
export async function logFeedbackEvent(userId: string, articleId: string, action: FeedbackAction): Promise<Feedback> {
  const { rows } = await sql`
    INSERT INTO feedback (user_id, article_id, action)
    VALUES (${userId}, ${articleId}, ${action})
    RETURNING *
  `;
  return rows[0] as Feedback;
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

/**
 * Get bookmarked articles using the is_bookmarked column on articles.
 * Returns articles regardless of archive status, ordered by most recently ingested.
 */
export async function getBookmarkedArticles(userId: string): Promise<ArticleWithSource[]> {
  const { rows } = await sql`
    SELECT a.*, s.name as source_name, s.type as source_type
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE a.is_bookmarked = TRUE
      AND a.source_id IN (SELECT id FROM sources WHERE user_id = ${userId})
    ORDER BY a.ingested_at DESC
  `;
  return rows as ArticleWithSource[];
}
