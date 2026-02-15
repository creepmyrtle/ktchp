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

  // Prefilter with detailed removal tracking
  const { kept: filtered, removed } = prefilterArticles(unscored);
  result.afterPrefilterCount = filtered.length;

  // Log prefilter summary with breakdown by reason
  const removalsByReason: Record<string, number> = {};
  for (const r of removed) {
    removalsByReason[r.reason] = (removalsByReason[r.reason] || 0) + 1;
  }
  logger?.log('prefilter', `Prefilter: ${unscored.length} → ${filtered.length} articles (${removed.length} removed)`, {
    inputCount: unscored.length,
    outputCount: filtered.length,
    removedCount: removed.length,
    removalsByReason,
  });

  // Log each removed article
  if (removed.length > 0) {
    logger?.log('prefilter', `Removed articles`, {
      articles: removed.map(r => ({ title: r.title, url: r.url, reason: r.reason })),
    });
  }

  // Log kept articles
  if (filtered.length > 0) {
    logger?.log('prefilter', `Kept articles`, {
      articles: filtered.map(a => ({ id: a.id, title: a.title, url: a.url })),
    });
  }

  // Load and log interests + preferences
  const interests = await getActiveInterestsByUserId(userId);
  const preferences = await getPreferencesByUserId(userId);

  logger?.log('scoring', `Scoring context loaded`, {
    interests: interests.map(i => ({ category: i.category, weight: i.weight, description: i.description })),
    preferences: preferences.map(p => ({ text: p.preference_text, confidence: p.confidence })),
  });

  const totalBatches = Math.ceil(filtered.length / config.batchSize);
  logger?.log('scoring', `Scoring ${filtered.length} articles in ${totalBatches} batch(es)`, {
    batchSize: config.batchSize,
  });

  const scores = await scoreArticles(filtered, interests, preferences, '', logger);
  result.articlesScored = scores.length;

  logger?.log('scoring', `Scoring complete: ${scores.length} articles scored`);

  for (const score of scores) {
    await updateArticleScoring(
      score.article_id,
      score.relevance_score,
      '',
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

  logger?.log('digest', `Digest selection starting`, {
    scoredUnassignedCount: scored.length,
    minRelevanceScore: minScore,
  });

  let selected = scored.filter(a => (a.relevance_score || 0) >= minScore);
  const rejected = scored.filter(a => (a.relevance_score || 0) < minScore);

  const serendipityItems = scored.filter(
    a => a.is_serendipity && (a.relevance_score || 0) >= 0.4
  );

  logger?.log('digest', `Serendipity candidates`, {
    count: serendipityItems.length,
    articles: serendipityItems.map(a => ({
      id: a.id,
      title: a.title,
      score: a.relevance_score,
    })),
  });

  for (const item of serendipityItems.slice(0, 2)) {
    if (!selected.find(s => s.id === item.id)) {
      selected.push(item);
    }
  }

  // Log rejected articles
  if (rejected.length > 0) {
    logger?.log('digest', `Articles below threshold (rejected)`, {
      count: rejected.length,
      articles: rejected.map(a => ({
        id: a.id,
        title: a.title,
        score: a.relevance_score,
        reason: a.relevance_reason,
      })),
    });
  }

  if (selected.length === 0) {
    logger?.warn('digest', 'No articles met the relevance threshold', {
      scoredCount: scored.length,
      minScore,
    });
    return { digestId: null, articleCount: 0, scoredUnassignedCount: scored.length };
  }

  // Log selected articles
  logger?.log('digest', `Articles selected for digest`, {
    count: selected.length,
    articles: selected.map(a => ({
      id: a.id,
      title: a.title,
      score: a.relevance_score,
      reason: a.relevance_reason,
      isSerendipity: a.is_serendipity,
    })),
  });

  const digest = await createDigest(userId, selected.length, provider);
  await assignArticlesToDigest(selected.map(a => a.id), digest.id);
  await updateDigestArticleCount(digest.id, selected.length);

  logger?.log('digest', `Digest created`, {
    digestId: digest.id,
    articleCount: selected.length,
    minScore,
    serendipityIncluded: serendipityItems.filter(s => selected.find(sel => sel.id === s.id)).length,
  });

  return { digestId: digest.id, articleCount: selected.length, scoredUnassignedCount: scored.length };
}
