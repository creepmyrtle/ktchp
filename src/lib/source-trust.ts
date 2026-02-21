import { sql } from '@vercel/postgres';
import { getEnabledSourcesForUser } from './db/sources';
import { upsertSourceTrust } from './db/source-trust';
import { getGlobalSetting } from './db/settings';
import type { IngestionLogger } from './ingestion/logger';

const DEFAULT_TRUST_MIN = 0.8;
const DEFAULT_TRUST_MAX = 1.2;

interface SourceFeedbackStats {
  source_id: string;
  liked: number;
  neutral: number;
  disliked: number;
  total: number;
}

async function getSourceFeedbackStats(userId: string, daysBack: number = 60): Promise<SourceFeedbackStats[]> {
  const { rows } = await sql`
    SELECT
      a.source_id,
      COUNT(*) FILTER (WHERE ua.sentiment = 'liked') as liked,
      COUNT(*) FILTER (WHERE ua.sentiment = 'neutral') as neutral,
      COUNT(*) FILTER (WHERE ua.sentiment = 'disliked') as disliked,
      COUNT(*) as total
    FROM user_articles ua
    JOIN articles a ON ua.article_id = a.id
    WHERE ua.user_id = ${userId}
      AND ua.sentiment IS NOT NULL
      AND ua.scored_at > NOW() - INTERVAL '1 day' * ${daysBack}
    GROUP BY a.source_id
  `;
  return rows.map(r => ({
    source_id: r.source_id,
    liked: parseInt(r.liked, 10),
    neutral: parseInt(r.neutral, 10),
    disliked: parseInt(r.disliked, 10),
    total: parseInt(r.total, 10),
  }));
}

export async function recomputeSourceTrust(userId: string, logger?: IngestionLogger): Promise<number> {
  const sources = await getEnabledSourcesForUser(userId);
  const stats = await getSourceFeedbackStats(userId);

  const [minSetting, maxSetting] = await Promise.all([
    getGlobalSetting('source_trust_min'),
    getGlobalSetting('source_trust_max'),
  ]);

  const trustMin = minSetting ? parseFloat(minSetting) : DEFAULT_TRUST_MIN;
  const trustMax = maxSetting ? parseFloat(maxSetting) : DEFAULT_TRUST_MAX;

  const statsMap = new Map(stats.map(s => [s.source_id, s]));
  let updated = 0;

  for (const source of sources) {
    const s = statsMap.get(source.id);
    if (!s || s.total < 5) {
      // Not enough data — set neutral trust
      await upsertSourceTrust(userId, source.id, 1.0, s?.total ?? 0);
      continue;
    }

    // Compute sentiment score from -1 (all disliked) to +1 (all liked)
    const sentimentScore = (s.liked - s.disliked) / s.total;

    // Map to trust multiplier range
    const range = trustMax - trustMin;
    const midpoint = (trustMax + trustMin) / 2;
    const trustFactor = Math.max(trustMin, Math.min(trustMax, midpoint + (sentimentScore * range / 2)));

    await upsertSourceTrust(userId, source.id, parseFloat(trustFactor.toFixed(3)), s.total);
    updated++;
  }

  if (updated > 0) {
    logger?.log('source_trust', `Updated trust factors for ${updated} source(s)`);
  }
  return updated;
}
