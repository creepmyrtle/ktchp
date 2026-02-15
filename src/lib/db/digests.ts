import { sql } from '@vercel/postgres';
import type { Digest } from '@/types';

export async function createDigest(userId: string, articleCount: number, provider: string = 'anthropic'): Promise<Digest> {
  const { rows } = await sql`
    INSERT INTO digests (user_id, article_count, provider)
    VALUES (${userId}, ${articleCount}, ${provider})
    RETURNING *
  `;
  return rows[0] as Digest;
}

export async function getLatestDigest(userId: string, provider?: string): Promise<Digest | null> {
  if (provider) {
    const { rows } = await sql`
      SELECT * FROM digests WHERE user_id = ${userId} AND provider = ${provider} ORDER BY generated_at DESC LIMIT 1
    `;
    return (rows[0] as Digest) ?? null;
  }
  const { rows } = await sql`
    SELECT * FROM digests WHERE user_id = ${userId} ORDER BY generated_at DESC LIMIT 1
  `;
  return (rows[0] as Digest) ?? null;
}

export async function getDigestById(id: string): Promise<Digest | null> {
  const { rows } = await sql`SELECT * FROM digests WHERE id = ${id}`;
  return (rows[0] as Digest) ?? null;
}

export async function getRecentDigests(userId: string, limit: number = 10, provider?: string): Promise<Digest[]> {
  if (provider) {
    const { rows } = await sql`
      SELECT * FROM digests WHERE user_id = ${userId} AND provider = ${provider} ORDER BY generated_at DESC LIMIT ${limit}
    `;
    return rows as Digest[];
  }
  const { rows } = await sql`
    SELECT * FROM digests WHERE user_id = ${userId} ORDER BY generated_at DESC LIMIT ${limit}
  `;
  return rows as Digest[];
}

export async function updateDigestArticleCount(id: string, count: number): Promise<void> {
  await sql`UPDATE digests SET article_count = ${count} WHERE id = ${id}`;
}

export async function clearDigestsByProvider(provider: string): Promise<void> {
  await sql`DELETE FROM digests WHERE provider = ${provider}`;
}
