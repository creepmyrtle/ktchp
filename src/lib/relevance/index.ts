import { config } from '../config';
import { getUnscoredArticles, updateArticleScoring, assignArticlesToDigest, getScoredUnassignedArticles } from '../db/articles';
import { createDigest, updateDigestArticleCount } from '../db/digests';
import { getActiveInterestsByUserId } from '../db/interests';
import { getPreferencesByUserId } from '../db/preferences';
import { prefilterArticles } from './prefilter';
import { scoreArticles } from './scorer';
import type { IngestionLogger } from '../ingestion/logger';

interface RelevanceResult {
  articlesScored: number;
  digestId: string | null;
  digestArticleCount: number;
  unscoredCount: number;
  afterPrefilterCount: number;
  scoredUnassignedCount: number;
}

export async function runRelevanceEngine(userId: string, provider: string, logger?: IngestionLogger): Promise<RelevanceResult> {
  const result: RelevanceResult = {
    articlesScored: 0,
    digestId: null,
    digestArticleCount: 0,
    unscoredCount: 0,
    afterPrefilterCount: 0,
    scoredUnassignedCount: 0,
  };

  const unscored = await getUnscoredArticles(provider);
  result.unscoredCount = unscored.length;

  logger?.log('relevance', `Found ${unscored.length} unscored articles`);

  if (unscored.length === 0) return result;

  const filtered = prefilterArticles(unscored);
  result.afterPrefilterCount = filtered.length;

  const removed = unscored.length - filtered.length;
  logger?.log('prefilter', `Prefilter: ${unscored.length} → ${filtered.length} articles (${removed} removed)`);

  const interests = await getActiveInterestsByUserId(userId);
  const preferences = await getPreferencesByUserId(userId);

  const totalBatches = Math.ceil(filtered.length / config.batchSize);
  logger?.log('scoring', `Scoring ${filtered.length} articles in ${totalBatches} batch(es)`);

  const scores = await scoreArticles(filtered, interests, preferences);
  result.articlesScored = scores.length;

  logger?.log('scoring', `Scoring complete: ${scores.length} articles scored`);

  for (const score of scores) {
    await updateArticleScoring(
      score.article_id,
      score.relevance_score,
      score.summary,
      score.relevance_reason,
      score.is_serendipity
    );
  }

  const digestResult = await generateDigest(userId, provider, logger);
  result.digestId = digestResult.digestId;
  result.digestArticleCount = digestResult.articleCount;
  result.scoredUnassignedCount = digestResult.scoredUnassignedCount;

  return result;
}

async function generateDigest(userId: string, provider: string, logger?: IngestionLogger): Promise<{ digestId: string | null; articleCount: number; scoredUnassignedCount: number }> {
  const scored = await getScoredUnassignedArticles(provider);
  if (scored.length === 0) {
    logger?.log('digest', 'No scored articles available for digest');
    return { digestId: null, articleCount: 0, scoredUnassignedCount: 0 };
  }

  const minScore = config.minRelevanceScore;

  let selected = scored.filter(a => (a.relevance_score || 0) >= minScore);

  const serendipityItems = scored.filter(
    a => a.is_serendipity && (a.relevance_score || 0) >= 0.4
  );
  for (const item of serendipityItems.slice(0, 2)) {
    if (!selected.find(s => s.id === item.id)) {
      selected.push(item);
    }
  }

  if (selected.length === 0) {
    logger?.warn('digest', 'No articles met the relevance threshold', {
      scoredCount: scored.length,
      minScore,
    });
    return { digestId: null, articleCount: 0, scoredUnassignedCount: scored.length };
  }

  const digest = await createDigest(userId, selected.length, provider);
  await assignArticlesToDigest(selected.map(a => a.id), digest.id);
  await updateDigestArticleCount(digest.id, selected.length);

  logger?.log('digest', `Digest created: ${selected.length} articles selected from ${scored.length} scored`, {
    digestId: digest.id,
    minScore,
    serendipityCount: serendipityItems.length,
  });

  return { digestId: digest.id, articleCount: selected.length, scoredUnassignedCount: scored.length };
}
