import { sql } from '@vercel/postgres';
import type { Article, ArticleWithSource, RawArticle, Sentiment, ArticleEngagementState } from '@/types';

export async function createArticle(article: RawArticle, provider: string = 'anthropic'): Promise<Article | null> {
  try {
    const { rows } = await sql`
      INSERT INTO articles (source_id, external_id, title, url, raw_content, published_at, provider)
      VALUES (${article.source_id}, ${article.external_id}, ${article.title}, ${article.url}, ${article.content}, ${article.published_at}, ${provider})
      RETURNING *
    `;
    return rows[0] as Article;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('unique')) return null;
    if (e instanceof Error && e.message.includes('duplicate')) return null;
    throw e;
  }
}

export async function getArticleById(id: string): Promise<Article | null> {
  const { rows } = await sql`SELECT * FROM articles WHERE id = ${id}`;
  return (rows[0] as Article) ?? null;
}

export async function getUnscoredArticles(provider: string): Promise<Article[]> {
  const { rows } = await sql`
    SELECT * FROM articles WHERE relevance_score IS NULL AND provider = ${provider} ORDER BY ingested_at DESC
  `;
  return rows as Article[];
}

export async function getArticlesByDigestId(digestId: string, includeArchived: boolean = false): Promise<ArticleWithSource[]> {
  if (includeArchived) {
    const { rows } = await sql`
      SELECT a.*, s.name as source_name, s.type as source_type
      FROM articles a
      JOIN sources s ON a.source_id = s.id
      WHERE a.digest_id = ${digestId}
      ORDER BY a.relevance_score DESC
    `;
    return rows as ArticleWithSource[];
  }
  const { rows } = await sql`
    SELECT a.*, s.name as source_name, s.type as source_type
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE a.digest_id = ${digestId} AND a.is_archived = FALSE
    ORDER BY a.relevance_score DESC
  `;
  return rows as ArticleWithSource[];
}

export async function getDigestCompletionStats(digestId: string): Promise<{
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
    FROM articles
    WHERE digest_id = ${digestId}
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

export async function updateArticleScoring(
  id: string,
  score: number,
  summary: string,
  reason: string,
  isSerendipity: boolean
): Promise<void> {
  await sql`
    UPDATE articles
    SET relevance_score = ${score}, summary = ${summary}, relevance_reason = ${reason}, is_serendipity = ${isSerendipity}
    WHERE id = ${id}
  `;
}

export async function assignArticlesToDigest(articleIds: string[], digestId: string): Promise<void> {
  for (const id of articleIds) {
    await sql`UPDATE articles SET digest_id = ${digestId} WHERE id = ${id}`;
  }
}

export async function getRecentArticleExternalIds(sourceId: string, provider: string): Promise<Set<string>> {
  const { rows } = await sql`
    SELECT external_id FROM articles
    WHERE source_id = ${sourceId} AND external_id IS NOT NULL AND provider = ${provider}
  `;
  return new Set(rows.map(r => r.external_id));
}

export async function getScoredUnassignedArticles(provider: string): Promise<Article[]> {
  const { rows } = await sql`
    SELECT * FROM articles
    WHERE relevance_score IS NOT NULL
      AND digest_id IS NULL
      AND provider = ${provider}
      AND ingested_at > NOW() - INTERVAL '7 days'
    ORDER BY relevance_score DESC
  `;
  return rows as Article[];
}

export async function clearArticlesByProvider(provider: string): Promise<void> {
  await sql`
    DELETE FROM feedback WHERE article_id IN (
      SELECT id FROM articles WHERE provider = ${provider}
    )
  `;
  await sql`DELETE FROM articles WHERE provider = ${provider}`;
}

// --- Engagement state mutations ---

export async function updateArticleSentiment(id: string, sentiment: Sentiment | null): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE articles SET sentiment = ${sentiment}
    WHERE id = ${id}
    RETURNING id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function updateArticleRead(id: string, isRead: boolean): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE articles SET is_read = ${isRead}
    WHERE id = ${id}
    RETURNING id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function updateArticleBookmark(id: string, isBookmarked: boolean): Promise<ArticleEngagementState> {
  const { rows } = await sql`
    UPDATE articles SET is_bookmarked = ${isBookmarked}
    WHERE id = ${id}
    RETURNING id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function archiveArticle(id: string): Promise<ArticleEngagementState | null> {
  // Check sentiment first
  const article = await getArticleById(id);
  if (!article || !article.sentiment) return null;

  const { rows } = await sql`
    UPDATE articles SET is_archived = TRUE, archived_at = NOW()
    WHERE id = ${id}
    RETURNING id, sentiment, is_read, is_bookmarked, is_archived
  `;
  const r = rows[0];
  return { articleId: r.id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}

export async function getArticleEngagementState(id: string): Promise<ArticleEngagementState | null> {
  const { rows } = await sql`
    SELECT id, sentiment, is_read, is_bookmarked, is_archived FROM articles WHERE id = ${id}
  `;
  if (!rows[0]) return null;
  const r = rows[0];
  return { articleId: r.id, sentiment: r.sentiment, is_read: r.is_read, is_bookmarked: r.is_bookmarked, is_archived: r.is_archived };
}
