import { sql } from '@vercel/postgres';

// Metric 1: Feedback rate by tier
export interface TierFeedback {
  tier: string;
  total: number;
  rated: number;
  liked: number;
  skipped: number;
  bookmarked: number;
}

export async function getFeedbackByTier(days: number): Promise<TierFeedback[]> {
  const { rows } = await sql`
    SELECT
      COALESCE(ua.digest_tier, 'recommended') as tier,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE ua.sentiment IS NOT NULL) as rated,
      COUNT(*) FILTER (WHERE ua.sentiment = 'liked') as liked,
      COUNT(*) FILTER (WHERE ua.sentiment = 'skipped') as skipped,
      COUNT(*) FILTER (WHERE ua.is_bookmarked = TRUE) as bookmarked
    FROM user_articles ua
    WHERE ua.digest_id IS NOT NULL
      AND ua.scored_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY COALESCE(ua.digest_tier, 'recommended')
    ORDER BY
      CASE COALESCE(ua.digest_tier, 'recommended')
        WHEN 'recommended' THEN 1
        WHEN 'serendipity' THEN 2
        WHEN 'bonus' THEN 3
      END
  `;
  return rows.map(r => ({
    tier: r.tier,
    total: parseInt(r.total, 10),
    rated: parseInt(r.rated, 10),
    liked: parseInt(r.liked, 10),
    skipped: parseInt(r.skipped, 10),
    bookmarked: parseInt(r.bookmarked, 10),
  }));
}

// Metric 2: Score band distribution with feedback
export interface ScoreBand {
  band: string;
  band_min: number;
  count: number;
  liked: number;
  skipped: number;
  avg_sentiment: number;
}

export async function getScoreBandDistribution(days: number): Promise<ScoreBand[]> {
  const { rows } = await sql`
    SELECT
      CASE
        WHEN relevance_score >= 0.8 THEN '0.8 - 1.0'
        WHEN relevance_score >= 0.6 THEN '0.6 - 0.8'
        WHEN relevance_score >= 0.4 THEN '0.4 - 0.6'
        WHEN relevance_score >= 0.2 THEN '0.2 - 0.4'
        ELSE '0.0 - 0.2'
      END as band,
      CASE
        WHEN relevance_score >= 0.8 THEN 0.8
        WHEN relevance_score >= 0.6 THEN 0.6
        WHEN relevance_score >= 0.4 THEN 0.4
        WHEN relevance_score >= 0.2 THEN 0.2
        ELSE 0.0
      END as band_min,
      COUNT(*) FILTER (WHERE sentiment IS NOT NULL) as count,
      COUNT(*) FILTER (WHERE sentiment = 'liked') as liked,
      COUNT(*) FILTER (WHERE sentiment = 'skipped') as skipped,
      AVG(CASE sentiment WHEN 'liked' THEN 1.0 WHEN 'skipped' THEN -0.3 END) as avg_sentiment
    FROM user_articles
    WHERE relevance_score IS NOT NULL
      AND sentiment IS NOT NULL
      AND scored_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY band, band_min
    ORDER BY band_min DESC
  `;
  return rows.map(r => ({
    band: r.band,
    band_min: parseFloat(r.band_min),
    count: parseInt(r.count, 10),
    liked: parseInt(r.liked, 10),
    skipped: parseInt(r.skipped, 10),
    avg_sentiment: r.avg_sentiment ? parseFloat(parseFloat(r.avg_sentiment).toFixed(2)) : 0,
  }));
}

// Metric 3: Per-interest accuracy
export interface InterestAccuracy {
  interest_id: string;
  category: string;
  total: number;
  liked: number;
  skipped: number;
  accuracy: number;
}

export async function getInterestAccuracy(days: number): Promise<InterestAccuracy[]> {
  // Match articles to interests via relevance_reason "Matches: <interest>"
  const { rows } = await sql`
    SELECT
      i.id as interest_id,
      i.category,
      COUNT(*) FILTER (WHERE ua.sentiment IS NOT NULL) as total,
      COUNT(*) FILTER (WHERE ua.sentiment = 'liked') as liked,
      COUNT(*) FILTER (WHERE ua.sentiment = 'skipped') as skipped
    FROM interests i
    JOIN user_articles ua ON ua.relevance_reason LIKE '%' || i.category || '%'
      AND ua.user_id = i.user_id
    WHERE ua.scored_at > NOW() - INTERVAL '1 day' * ${days}
      AND ua.sentiment IS NOT NULL
      AND i.active = TRUE
    GROUP BY i.id, i.category
    HAVING COUNT(*) FILTER (WHERE ua.sentiment IS NOT NULL) >= 3
    ORDER BY
      CASE WHEN COUNT(*) FILTER (WHERE ua.sentiment = 'liked') + COUNT(*) FILTER (WHERE ua.sentiment = 'skipped') > 0
        THEN COUNT(*) FILTER (WHERE ua.sentiment = 'liked')::float / (COUNT(*) FILTER (WHERE ua.sentiment = 'liked') + COUNT(*) FILTER (WHERE ua.sentiment = 'skipped'))
        ELSE 0
      END DESC
  `;
  return rows.map(r => {
    const liked = parseInt(r.liked, 10);
    const skipped = parseInt(r.skipped, 10);
    const accuracy = liked + skipped > 0 ? liked / (liked + skipped) : 0;
    return {
      interest_id: r.interest_id,
      category: r.category,
      total: parseInt(r.total, 10),
      liked,
      skipped,
      accuracy: parseFloat(accuracy.toFixed(2)),
    };
  });
}

// Metric 4: Score-feedback correlation
export interface CorrelationResult {
  llm_correlation: number | null;
  embedding_correlation: number | null;
  sample_size: number;
}

export async function getScoreFeedbackCorrelation(days: number): Promise<CorrelationResult> {
  const { rows } = await sql`
    SELECT
      CORR(relevance_score, CASE sentiment WHEN 'liked' THEN 1.0 WHEN 'skipped' THEN -0.3 END) as llm_corr,
      CORR(embedding_score, CASE sentiment WHEN 'liked' THEN 1.0 WHEN 'skipped' THEN -0.3 END) as emb_corr,
      COUNT(*) as sample_size
    FROM user_articles
    WHERE relevance_score IS NOT NULL
      AND sentiment IS NOT NULL
      AND scored_at > NOW() - INTERVAL '1 day' * ${days}
  `;
  const r = rows[0];
  return {
    llm_correlation: r.llm_corr ? parseFloat(parseFloat(r.llm_corr).toFixed(3)) : null,
    embedding_correlation: r.emb_corr ? parseFloat(parseFloat(r.emb_corr).toFixed(3)) : null,
    sample_size: parseInt(r.sample_size, 10),
  };
}

// Threshold recommendation
export interface ThresholdRecommendation {
  current_threshold: number;
  bonus_like_rate: number | null;
  recommended_skip_rate: number | null;
  suggestion: string | null;
  suggested_threshold: number | null;
}

export async function getThresholdRecommendation(days: number, currentThreshold: number): Promise<ThresholdRecommendation> {
  // Get like/skip rates for bonus vs recommended
  const { rows } = await sql`
    SELECT
      COALESCE(digest_tier, 'recommended') as tier,
      COUNT(*) FILTER (WHERE sentiment = 'liked') as liked,
      COUNT(*) FILTER (WHERE sentiment = 'skipped') as skipped,
      COUNT(*) FILTER (WHERE sentiment IS NOT NULL) as rated
    FROM user_articles
    WHERE digest_id IS NOT NULL
      AND sentiment IS NOT NULL
      AND scored_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY COALESCE(digest_tier, 'recommended')
  `;

  let bonusLikeRate: number | null = null;
  let recommendedSkipRate: number | null = null;

  for (const r of rows) {
    const rated = parseInt(r.rated, 10);
    if (rated === 0) continue;
    if (r.tier === 'bonus') {
      bonusLikeRate = parseInt(r.liked, 10) / rated;
    }
    if (r.tier === 'recommended') {
      recommendedSkipRate = parseInt(r.skipped, 10) / rated;
    }
  }

  let suggestion: string | null = null;
  let suggestedThreshold: number | null = null;

  if (bonusLikeRate !== null && bonusLikeRate > 0.35) {
    suggestedThreshold = Math.max(currentThreshold - 0.1, 0.2);
    suggestion = `${Math.round(bonusLikeRate * 100)}% of bonus articles are being liked. Consider lowering threshold from ${currentThreshold} to ${suggestedThreshold}.`;
  } else if (recommendedSkipRate !== null && recommendedSkipRate > 0.30) {
    suggestedThreshold = Math.min(currentThreshold + 0.1, 0.9);
    suggestion = `${Math.round(recommendedSkipRate * 100)}% of recommended articles are being skipped. Consider raising threshold from ${currentThreshold} to ${suggestedThreshold}.`;
  }

  return {
    current_threshold: currentThreshold,
    bonus_like_rate: bonusLikeRate !== null ? parseFloat(bonusLikeRate.toFixed(2)) : null,
    recommended_skip_rate: recommendedSkipRate !== null ? parseFloat(recommendedSkipRate.toFixed(2)) : null,
    suggestion,
    suggested_threshold: suggestedThreshold,
  };
}
