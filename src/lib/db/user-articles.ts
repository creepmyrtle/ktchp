import { sql } from '@vercel/postgres';
import type { UserArticleWithSource, ArticleEngagementState, Sentiment } from '@/types';

export async function getUserArticlesByDigestId(
  userId: string,
  digestId: string,
  includeArchived: boolean = false
): Promise<UserArticleWithSource[]> {
  if (includeArchived) {
    const { rows } = await sql`
      SELECT ua.*, a.title, a.url, a.raw_content, a.summary, a.provider, a.published_at, a.ingested_at, a.source_id,
             s.name as source_name, s.type as source_type
      FROM user_articles ua
      JOIN articles a ON ua.article_id = a.id
      JOIN sources s ON a.source_id = s.id
      WHERE ua.user_id = ${userId} AND ua.digest_id = ${digestId}
      ORDER BY ua.relevance_score DESC
    `;
    return rows as UserArticleWithSource[];
  }
  const { rows } = await sql`
    SELECT ua.*, a.title, a.url, a.raw_content, a.summary, a.provider, a.published_at, a.ingested_at, a.source_id,
           s.name as source_name, s.type as source_type
    FROM user_articles ua
    JOIN articles a ON ua.article_id = a.id
    JOIN sources s ON a.source_id = s.id
    WHERE ua.user_id = ${userId} AND ua.digest_id = ${digestId} AND ua.is_archived = FALSE
    ORDER BY ua.relevance_score DESC
  `;
  return rows as UserArticleWithSource[];
}

export async function getDigestCompletionStats(userId: string, digestId: string): Promise<{
  total_article_count: number;
  archived_count: number;
  remaining_count: number;
  liked_count: number;
  neutral_count: number;
  disliked_count: number;
  bookmarked_count: number;
}> {
  const { rows } = await sql`
    SELECT
      COUNT(*) as total_article_count,
      COUNT(*) FILTER (WHERE is_archived = TRUE) as archived_count,
      COUNT(*) FILTER (WHERE is_archived = FALSE) as remaining_count,
      COUNT(*) FILTER (WHERE sentiment = 'liked') as liked_count,
      COUNT(*) FILTER (WHERE sentiment = 'neutral') as neutral_count,
      COUNT(*) FILTER (WHERE sentiment = 'disliked') as disliked_count,
      COUNT(*) FILTER (WHERE is_bookmarked = TRUE) as bookmarked_count
    FROM user_articles
    WHERE user_id = ${userId} AND digest_id = ${digestId}
  `;
  const r = rows[0];
  return {
    total_article_count: parseInt(r.total_article_count, 10),
    archived_count: parseInt(r.archived_count, 10),
    remaining_count: parseInt(r.remaining_count, 10),
    liked_count: parseInt(r.liked_count, 10),
    neutral_count: parseInt(r.neutral_count, 10),
    disliked_count: parseInt(r.disliked_count, 10),
    bookmarked_count: parseInt(r.bookmarked_count, 10),
  };
}

export async function getUnscoredArticlesForUser(
  userId: string,
  sourceIds: string[]
): Promise<{ id: string; source_id: string; title: string; url: string; raw_content: string | null; published_at: string | null }[]> {
  if (sourceIds.length === 0) return [];
  // Articles that either have no user_articles row, were fallback-scored, or had scores cleared
  const placeholders = sourceIds.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await sql.query(
    `SELECT a.id, a.source_id, a.title, a.url, a.raw_content, a.published_at
     FROM articles a
     WHERE a.source_id IN (${placeholders})
       AND (
         NOT EXISTS (
           SELECT 1 FROM user_articles ua WHERE ua.article_id = a.id AND ua.user_id = $1
         )
         OR EXISTS (
           SELECT 1 FROM user_articles ua WHERE ua.article_id = a.id AND ua.user_id = $1
             AND (ua.relevance_reason LIKE 'Default score%' OR ua.relevance_score IS NULL)
         )
       )
     ORDER BY a.ingested_at DESC`,
    [userId, ...sourceIds]
  );
  return rows;
}

export async function getScoredUnassignedForUser(
  userId: string
): Promise<{ id: string; article_id: string; relevance_score: number; is_serendipity: boolean }[]> {
  const { rows } = await sql`
    SELECT ua.id, ua.article_id, ua.relevance_score, ua.is_serendipity
    FROM user_articles ua
    JOIN articles a ON ua.article_id = a.id
    WHERE ua.user_id = ${userId}
      AND ua.relevance_score IS NOT NULL
      AND ua.digest_id IS NULL
      AND a.ingested_at > NOW() - INTERVAL '7 days'
    ORDER BY ua.relevance_score DESC
  `;
  return rows as { id: string; article_id: string; relevance_score: number; is_serendipity: boolean }[];
}

export async function setEmbeddingScore(
  userId: string,
  articleId: string,
  embeddingScore: number
): Promise<void> {
  await sql`
    INSERT INTO user_articles (user_id, article_id, embedding_score)
    VALUES (${userId}, ${articleId}, ${embeddingScore})
    ON CONFLICT (user_id, article_id) DO UPDATE SET
      embedding_score = ${embeddingScore}
  `;
}

export async function createUserArticleScoring(
  userId: string,
  articleId: string,
  score: number,
  reason: string,
  isSerendipity: boolean
): Promise<void> {
  await sql`
    INSERT INTO user_articles (user_id, article_id, relevance_score, relevance_reason, is_serendipity, scored_at)
    VALUES (${userId}, ${articleId}, ${score}, ${reason}, ${isSerendipity}, NOW())
    ON CONFLICT (user_id, article_id) DO UPDATE SET
      relevance_score = ${score},
      relevance_reason = ${reason},
      is_serendipity = ${isSerendipity},
      scored_at = NOW()
  `;
}

export async function assignUserArticlesToDigest(
  userId: string,
  articleIds: string[],
  digestId: string
): Promise<void> {
  for (const articleId of articleIds) {
    await sql`
      UPDATE user_articles SET digest_id = ${digestId}
      WHERE user_id = ${userId} AND article_id = ${articleId}
    `;
  }
}

export async function updateUserArticleSentiment(
  userId: string,
  articleId: string,
  sentiment: Sentiment | null
): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE user_articles SET sentiment = ${sentiment}
    WHERE user_id = ${userId} AND article_id = ${articleId}
    RETURNING article_id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.article_id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function updateUserArticleRead(
  userId: string,
  articleId: string,
  isRead: boolean
): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE user_articles SET is_read = ${isRead}
    WHERE user_id = ${userId} AND article_id = ${articleId}
    RETURNING article_id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.article_id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function updateUserArticleBookmark(
  userId: string,
  articleId: string,
  isBookmarked: boolean
): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE user_articles SET is_bookmarked = ${isBookmarked}
    WHERE user_id = ${userId} AND article_id = ${articleId}
    RETURNING article_id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.article_id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function archiveUserArticle(
  userId: string,
  articleId: string
): Promise<ArticleEngagementState | null> {
  // Check sentiment first
  const { rows: checkRows } = await sql`
    SELECT sentiment FROM user_articles WHERE user_id = ${userId} AND article_id = ${articleId}
  `;
  if (!checkRows[0] || !checkRows[0].sentiment) return null;

  const { rows } = await sql`
    UPDATE user_articles SET is_archived = TRUE, archived_at = NOW()
    WHERE user_id = ${userId} AND article_id = ${articleId}
    RETURNING article_id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.article_id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function getUserArticleEngagementState(
  userId: string,
  articleId: string
): Promise<ArticleEngagementState | null> {
  const { rows } = await sql`
    SELECT article_id, sentiment, is_read, is_bookmarked, is_archived
    FROM user_articles
    WHERE user_id = ${userId} AND article_id = ${articleId}
  `;
  if (!rows[0]) return null;
  const r = rows[0];
  return { articleId: r.article_id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function getUserArticleByArticleId(
  userId: string,
  articleId: string
): Promise<{ sentiment: Sentiment | null; is_read: boolean; is_bookmarked: boolean; is_archived: boolean } | null> {
  const { rows } = await sql`
    SELECT sentiment, is_read, is_bookmarked, is_archived
    FROM user_articles
    WHERE user_id = ${userId} AND article_id = ${articleId}
  `;
  if (!rows[0]) return null;
  const r = rows[0];
  return { sentiment: r.sentiment as Sentiment | null, is_read: r.is_read as boolean, is_bookmarked: r.is_bookmarked as boolean, is_archived: r.is_archived as boolean };
}
