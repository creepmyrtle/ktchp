import { sql } from '@vercel/postgres';
import type { SourceTrust } from '@/types';

export async function getSourceTrustFactors(userId: string): Promise<Map<string, number>> {
  const { rows } = await sql`
    SELECT source_id, trust_factor FROM source_trust WHERE user_id = ${userId}
  `;
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.source_id, parseFloat(row.trust_factor));
  }
  return map;
}

export async function getSourceTrustForUser(userId: string): Promise<SourceTrust[]> {
  const { rows } = await sql`
    SELECT * FROM source_trust WHERE user_id = ${userId} ORDER BY trust_factor DESC
  `;
  return rows as SourceTrust[];
}

export async function upsertSourceTrust(
  userId: string,
  sourceId: string,
  trustFactor: number,
  sampleSize: number
): Promise<void> {
  await sql`
    INSERT INTO source_trust (user_id, source_id, trust_factor, sample_size, updated_at)
    VALUES (${userId}, ${sourceId}, ${trustFactor}, ${sampleSize}, NOW())
    ON CONFLICT (user_id, source_id) DO UPDATE SET
      trust_factor = ${trustFactor},
      sample_size = ${sampleSize},
      updated_at = NOW()
  `;
}
