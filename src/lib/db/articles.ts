import { sql } from '@vercel/postgres';
import type { Article, ArticleWithSource, RawArticle } from '@/types';

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

export async function getArticlesByDigestId(digestId: string): Promise<ArticleWithSource[]> {
  const { rows } = await sql`
    SELECT a.*, s.name as source_name, s.type as source_type
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE a.digest_id = ${digestId}
    ORDER BY a.relevance_score DESC
  `;
  return rows as ArticleWithSource[];
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
