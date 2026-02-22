import { sql } from '@vercel/postgres';
import { getGlobalSetting } from './settings';

// --- Cost Rates ---

export interface CostRates {
  embedding_per_million: number;
  llm_input_per_million: number;
  llm_output_per_million: number;
}

export async function getCostRates(): Promise<CostRates> {
  const [emb, llmIn, llmOut] = await Promise.all([
    getGlobalSetting('cost_rate_embedding'),
    getGlobalSetting('cost_rate_llm_input'),
    getGlobalSetting('cost_rate_llm_output'),
  ]);
  return {
    embedding_per_million: emb ? parseFloat(emb) : 0.02,
    llm_input_per_million: llmIn ? parseFloat(llmIn) : 0.15,
    llm_output_per_million: llmOut ? parseFloat(llmOut) : 0.60,
  };
}

function tokenCost(tokens: number, ratePerMillion: number): number {
  return (tokens / 1_000_000) * ratePerMillion;
}

// --- Cost Summary ---

export interface CostSummary {
  embedding_tokens: number;
  embedding_cost: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cost: number;
  total_cost: number;
  avg_cost_per_day: number;
  avg_cost_per_digest: number;
  projected_monthly: number;
  trend: 'up' | 'down' | 'flat';
}

export async function getCostSummary(days: number, rates: CostRates): Promise<CostSummary> {
  // Get token totals from ingestion logs for the current period
  const { rows: currentRows } = await sql`
    SELECT
      COALESCE(SUM((summary->>'embeddingTokens')::int), 0) as embedding_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmInputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_input_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmOutputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_output_tokens
    FROM ingestion_logs
    WHERE status = 'success'
      AND started_at > NOW() - INTERVAL '1 day' * ${days}
  `;

  // Get previous period for trend comparison
  const { rows: prevRows } = await sql`
    SELECT
      COALESCE(SUM((summary->>'embeddingTokens')::int), 0) as embedding_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmInputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_input_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmOutputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_output_tokens
    FROM ingestion_logs
    WHERE status = 'success'
      AND started_at > NOW() - INTERVAL '1 day' * ${days * 2}
      AND started_at <= NOW() - INTERVAL '1 day' * ${days}
  `;

  // Count digests in the period
  const { rows: digestRows } = await sql`
    SELECT COUNT(*) as digest_count
    FROM digests
    WHERE generated_at > NOW() - INTERVAL '1 day' * ${days}
  `;

  const cur = currentRows[0];
  const embTokens = parseInt(cur.embedding_tokens, 10);
  const llmInTokens = parseInt(cur.llm_input_tokens, 10);
  const llmOutTokens = parseInt(cur.llm_output_tokens, 10);

  const embCost = tokenCost(embTokens, rates.embedding_per_million);
  const llmCost = tokenCost(llmInTokens, rates.llm_input_per_million) + tokenCost(llmOutTokens, rates.llm_output_per_million);
  const totalCost = embCost + llmCost;

  const digestCount = parseInt(digestRows[0].digest_count, 10) || 1;
  const avgPerDay = days > 0 ? totalCost / days : 0;
  const avgPerDigest = totalCost / digestCount;

  // Trend: compare current vs previous period
  const prev = prevRows[0];
  const prevLlmIn = parseInt(prev.llm_input_tokens, 10);
  const prevLlmOut = parseInt(prev.llm_output_tokens, 10);
  const prevEmb = parseInt(prev.embedding_tokens, 10);
  const prevCost = tokenCost(prevEmb, rates.embedding_per_million)
    + tokenCost(prevLlmIn, rates.llm_input_per_million)
    + tokenCost(prevLlmOut, rates.llm_output_per_million);

  let trend: 'up' | 'down' | 'flat' = 'flat';
  if (prevCost > 0) {
    const change = (totalCost - prevCost) / prevCost;
    if (change > 0.1) trend = 'up';
    else if (change < -0.1) trend = 'down';
  }

  return {
    embedding_tokens: embTokens,
    embedding_cost: parseFloat(embCost.toFixed(4)),
    llm_input_tokens: llmInTokens,
    llm_output_tokens: llmOutTokens,
    llm_cost: parseFloat(llmCost.toFixed(4)),
    total_cost: parseFloat(totalCost.toFixed(4)),
    avg_cost_per_day: parseFloat(avgPerDay.toFixed(4)),
    avg_cost_per_digest: parseFloat(avgPerDigest.toFixed(4)),
    projected_monthly: parseFloat((avgPerDay * 30).toFixed(4)),
    trend,
  };
}

// --- Cost by User ---

export interface CostByUser {
  user_id: string;
  username: string;
  display_name: string;
  source_count: number;
  private_source_count: number;
  interest_count: number;
  exclusion_count: number;
  articles_ingested: number;
  articles_sent_to_llm: number;
  llm_tokens: number;
  estimated_cost: number;
  cost_per_day: number;
  is_outlier: boolean;
}

export async function getCostByUser(days: number, rates: CostRates): Promise<CostByUser[]> {
  // Get per-user LLM token usage from ingestion logs
  const { rows: tokenRows } = await sql`
    SELECT
      kv.key as user_id,
      COALESCE(SUM((kv.value->>'llmInputTokens')::int), 0) as llm_input_tokens,
      COALESCE(SUM((kv.value->>'llmOutputTokens')::int), 0) as llm_output_tokens,
      COALESCE(SUM((kv.value->>'sentToLlm')::int), 0) as sent_to_llm,
      COALESCE(SUM((kv.value->>'articlesScored')::int), 0) as articles_scored
    FROM ingestion_logs il,
      LATERAL jsonb_each(COALESCE(il.summary->'userResults', '{}'::jsonb)) AS kv(key, value)
    WHERE il.status = 'success'
      AND il.started_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY kv.key
  `;

  // Get user info and source counts
  const { rows: userRows } = await sql`
    SELECT
      u.id,
      u.username,
      u.display_name,
      (SELECT COUNT(*) FROM sources s
        LEFT JOIN user_source_settings uss ON uss.source_id = s.id AND uss.user_id = u.id
        WHERE (s.is_default = TRUE AND s.enabled = TRUE AND (uss.enabled IS NULL OR uss.enabled = TRUE))
          OR (s.user_id = u.id AND s.is_default = FALSE AND s.enabled = TRUE)
      ) as source_count,
      (SELECT COUNT(*) FROM sources s
        WHERE s.user_id = u.id AND s.is_default = FALSE AND s.enabled = TRUE
      ) as private_source_count,
      (SELECT COUNT(*) FROM interests i
        WHERE i.user_id = u.id AND i.active = TRUE
      ) as interest_count,
      (SELECT COUNT(*) FROM exclusions e
        WHERE e.user_id = u.id
      ) as exclusion_count
    FROM users u
    WHERE u.is_active = TRUE
  `;

  // Get articles ingested per user (articles from their enabled sources)
  const { rows: articleRows } = await sql`
    SELECT
      ua.user_id,
      COUNT(DISTINCT ua.article_id) as articles_ingested
    FROM user_articles ua
    WHERE ua.scored_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY ua.user_id
  `;

  const userMap = new Map(userRows.map(u => [u.id, u]));
  const articleMap = new Map(articleRows.map(a => [a.user_id, parseInt(a.articles_ingested, 10)]));

  const results: CostByUser[] = [];

  for (const tr of tokenRows) {
    const user = userMap.get(tr.user_id);
    if (!user) continue;

    const llmIn = parseInt(tr.llm_input_tokens, 10);
    const llmOut = parseInt(tr.llm_output_tokens, 10);
    const totalTokens = llmIn + llmOut;
    const cost = tokenCost(llmIn, rates.llm_input_per_million) + tokenCost(llmOut, rates.llm_output_per_million);

    results.push({
      user_id: tr.user_id,
      username: user.username,
      display_name: user.display_name || user.username,
      source_count: parseInt(user.source_count, 10),
      private_source_count: parseInt(user.private_source_count, 10),
      interest_count: parseInt(user.interest_count, 10),
      exclusion_count: parseInt(user.exclusion_count, 10),
      articles_ingested: articleMap.get(tr.user_id) || 0,
      articles_sent_to_llm: parseInt(tr.sent_to_llm, 10),
      llm_tokens: totalTokens,
      estimated_cost: parseFloat(cost.toFixed(4)),
      cost_per_day: parseFloat((days > 0 ? cost / days : 0).toFixed(4)),
      is_outlier: false, // computed below
    });
  }

  // Flag outliers (>1.5x average cost)
  if (results.length > 1) {
    const avgCost = results.reduce((sum, r) => sum + r.estimated_cost, 0) / results.length;
    for (const r of results) {
      r.is_outlier = r.estimated_cost > avgCost * 1.5;
    }
  }

  // Sort by estimated cost descending
  results.sort((a, b) => b.estimated_cost - a.estimated_cost);

  return results;
}

// --- Cost by Source ---

export interface CostBySource {
  source_id: string;
  source_name: string;
  is_default: boolean;
  owner_username: string | null;
  subscriber_count: number;
  articles_fetched: number;
  articles_sent_to_llm: number;
  estimated_token_contribution: number;
}

export async function getCostBySource(days: number): Promise<CostBySource[]> {
  // Get per-source article counts and LLM send counts from user_articles + articles
  const { rows } = await sql`
    SELECT
      s.id as source_id,
      s.name as source_name,
      s.is_default,
      owner.username as owner_username,
      (SELECT COUNT(DISTINCT uss2.user_id)
        FROM user_source_settings uss2
        WHERE uss2.source_id = s.id AND uss2.enabled = TRUE
      ) + CASE WHEN s.is_default THEN
        (SELECT COUNT(*) FROM users u2 WHERE u2.is_active = TRUE) -
        (SELECT COUNT(*) FROM user_source_settings uss3
          WHERE uss3.source_id = s.id AND uss3.enabled = FALSE)
      ELSE 0 END as subscriber_count,
      COUNT(DISTINCT a.id) as articles_fetched,
      COUNT(DISTINCT ua.article_id) FILTER (
        WHERE ua.relevance_score IS NOT NULL AND ua.relevance_score > 0
      ) as articles_sent_to_llm
    FROM sources s
    LEFT JOIN users owner ON owner.id = s.user_id AND s.is_default = FALSE
    LEFT JOIN articles a ON a.source_id = s.id
      AND a.ingested_at > NOW() - INTERVAL '1 day' * ${days}
    LEFT JOIN user_articles ua ON ua.article_id = a.id
      AND ua.scored_at > NOW() - INTERVAL '1 day' * ${days}
    WHERE s.enabled = TRUE
    GROUP BY s.id, s.name, s.is_default, owner.username
    HAVING COUNT(DISTINCT a.id) > 0
    ORDER BY COUNT(DISTINCT ua.article_id) FILTER (
      WHERE ua.relevance_score IS NOT NULL AND ua.relevance_score > 0
    ) DESC
    LIMIT 15
  `;

  // Get total LLM tokens in the period to pro-rate per source
  const { rows: totalRows } = await sql`
    SELECT
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmInputTokens')::int + (value->>'llmOutputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as total_llm_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'sentToLlm')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as total_sent_to_llm
    FROM ingestion_logs
    WHERE status = 'success'
      AND started_at > NOW() - INTERVAL '1 day' * ${days}
  `;

  const totalLlmTokens = parseInt(totalRows[0].total_llm_tokens, 10) || 1;
  const totalSentToLlm = parseInt(totalRows[0].total_sent_to_llm, 10) || 1;

  return rows.map(r => {
    const sentToLlm = parseInt(r.articles_sent_to_llm, 10);
    // Pro-rate token contribution based on proportion of articles sent to LLM
    const tokenContribution = Math.round((sentToLlm / totalSentToLlm) * totalLlmTokens);

    return {
      source_id: r.source_id,
      source_name: r.source_name,
      is_default: r.is_default,
      owner_username: r.owner_username || null,
      subscriber_count: parseInt(r.subscriber_count, 10),
      articles_fetched: parseInt(r.articles_fetched, 10),
      articles_sent_to_llm: sentToLlm,
      estimated_token_contribution: tokenContribution,
    };
  });
}

// --- Pipeline Efficiency ---

export interface PipelineEfficiency {
  articles_fetched: number;
  after_prefilter: number;
  articles_embedded: number;
  embedding_cost: number;
  total_user_article_pairs: number;
  passed_embedding_filter: number;
  sent_to_llm: number;
  filter_savings_percent: number;
  estimated_cost_without_embeddings: number;
  estimated_cost_with_embeddings: number;
  estimated_savings: number;
  filter_rate_by_user: Array<{ username: string; filter_rate: number }>;
}

export async function getPipelineEfficiency(days: number, rates: CostRates): Promise<PipelineEfficiency> {
  // Aggregate pipeline stats from ingestion logs
  const { rows } = await sql`
    SELECT
      COALESCE(SUM((summary->>'totalFetched')::int), 0) as total_fetched,
      COALESCE(SUM((summary->>'articlesEmbedded')::int), 0) as articles_embedded,
      COALESCE(SUM((summary->>'embeddingTokens')::int), 0) as embedding_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'afterPrefilterCount')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as after_prefilter,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'unscoredCount')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as total_user_article_pairs,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'aboveEmbeddingThreshold')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as passed_embedding,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'sentToLlm')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as sent_to_llm,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmInputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_input_tokens,
      COALESCE(SUM(
        (SELECT COALESCE(SUM((value->>'llmOutputTokens')::int), 0)
         FROM jsonb_each(COALESCE(summary->'userResults', '{}'::jsonb)) AS kv(key, value))
      ), 0) as llm_output_tokens
    FROM ingestion_logs
    WHERE status = 'success'
      AND started_at > NOW() - INTERVAL '1 day' * ${days}
  `;

  // Per-user filter rates
  const { rows: userFilterRows } = await sql`
    SELECT
      u.username,
      kv.key as user_id,
      COALESCE(SUM((kv.value->>'unscoredCount')::int), 0) as total_pairs,
      COALESCE(SUM((kv.value->>'sentToLlm')::int), 0) as sent_to_llm
    FROM ingestion_logs il,
      LATERAL jsonb_each(COALESCE(il.summary->'userResults', '{}'::jsonb)) AS kv(key, value)
    JOIN users u ON u.id = kv.key
    WHERE il.status = 'success'
      AND il.started_at > NOW() - INTERVAL '1 day' * ${days}
    GROUP BY u.username, kv.key
  `;

  const r = rows[0];
  const fetched = parseInt(r.total_fetched, 10);
  const afterPrefilter = parseInt(r.after_prefilter, 10);
  const embedded = parseInt(r.articles_embedded, 10);
  const embTokens = parseInt(r.embedding_tokens, 10);
  const totalPairs = parseInt(r.total_user_article_pairs, 10);
  const passedEmb = parseInt(r.passed_embedding, 10);
  const sentToLlm = parseInt(r.sent_to_llm, 10);
  const llmIn = parseInt(r.llm_input_tokens, 10);
  const llmOut = parseInt(r.llm_output_tokens, 10);

  const embCost = tokenCost(embTokens, rates.embedding_per_million);
  const llmCost = tokenCost(llmIn, rates.llm_input_per_million) + tokenCost(llmOut, rates.llm_output_per_million);
  const totalCostWithEmb = embCost + llmCost;

  // Estimate cost without embeddings: assume all user×article pairs would go to LLM
  // Pro-rate based on average tokens per article
  const avgTokensPerArticle = sentToLlm > 0 ? (llmIn + llmOut) / sentToLlm : 0;
  const costWithoutEmb = totalPairs > 0
    ? tokenCost(totalPairs * avgTokensPerArticle * 0.8, rates.llm_input_per_million)  // ~80% input
      + tokenCost(totalPairs * avgTokensPerArticle * 0.2, rates.llm_output_per_million) // ~20% output
    : 0;

  const filterSavings = totalPairs > 0 ? ((totalPairs - sentToLlm) / totalPairs) * 100 : 0;

  const filterRateByUser = userFilterRows.map(ufr => {
    const pairs = parseInt(ufr.total_pairs, 10);
    const sent = parseInt(ufr.sent_to_llm, 10);
    return {
      username: ufr.username,
      filter_rate: pairs > 0 ? parseFloat(((1 - sent / pairs) * 100).toFixed(0)) : 0,
    };
  });

  return {
    articles_fetched: fetched,
    after_prefilter: afterPrefilter,
    articles_embedded: embedded,
    embedding_cost: parseFloat(embCost.toFixed(4)),
    total_user_article_pairs: totalPairs,
    passed_embedding_filter: passedEmb,
    sent_to_llm: sentToLlm,
    filter_savings_percent: parseFloat(filterSavings.toFixed(0)),
    estimated_cost_without_embeddings: parseFloat(costWithoutEmb.toFixed(4)),
    estimated_cost_with_embeddings: parseFloat(totalCostWithEmb.toFixed(4)),
    estimated_savings: parseFloat((costWithoutEmb - totalCostWithEmb).toFixed(4)),
    filter_rate_by_user: filterRateByUser,
  };
}
