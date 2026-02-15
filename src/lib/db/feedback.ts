import { sql } from '@vercel/postgres';
import type { Feedback, FeedbackAction, UserArticleWithSource } from '@/types';

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
    SELECT f.*, a.title, a.url, ua.relevance_reason, s.name as source_name
    FROM feedback f
    JOIN articles a ON f.article_id = a.id
    LEFT JOIN user_articles ua ON ua.article_id = a.id AND ua.user_id = f.user_id
    JOIN sources s ON a.source_id = s.id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function getBookmarkedArticles(userId: string): Promise<UserArticleWithSource[]> {
  const { rows } = await sql`
    SELECT ua.*, a.title, a.url, a.raw_content, a.summary, a.provider, a.published_at, a.ingested_at, a.source_id,
           s.name as source_name, s.type as source_type
    FROM user_articles ua
    JOIN articles a ON ua.article_id = a.id
    JOIN sources s ON a.source_id = s.id
    WHERE ua.user_id = ${userId} AND ua.is_bookmarked = TRUE
    ORDER BY a.ingested_at DESC
  `;
  return rows as UserArticleWithSource[];
}
