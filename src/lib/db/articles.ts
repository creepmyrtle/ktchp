import { sql } from '@vercel/postgres';
import type { Article, RawArticle } from '@/types';

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

export async function getRecentArticleExternalIds(sourceId: string, provider: string): Promise<Set<string>> {
  const { rows } = await sql`
    SELECT external_id FROM articles
    WHERE source_id = ${sourceId} AND external_id IS NOT NULL AND provider = ${provider}
  `;
  return new Set(rows.map(r => r.external_id));
}

export async function clearArticlesByProvider(provider: string): Promise<void> {
  // Delete user_articles first (foreign key)
  await sql`
    DELETE FROM user_articles WHERE article_id IN (
      SELECT id FROM articles WHERE provider = ${provider}
    )
  `;
  await sql`
    DELETE FROM feedback WHERE article_id IN (
      SELECT id FROM articles WHERE provider = ${provider}
    )
  `;
  await sql`DELETE FROM articles WHERE provider = ${provider}`;
}
