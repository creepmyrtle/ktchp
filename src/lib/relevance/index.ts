import { config } from '../config';
import { getEnabledSourcesForUser } from '../db/sources';
import { createDigest, updateDigestArticleCount } from '../db/digests';
import { getActiveInterestsByUserId } from '../db/interests';
import { getPreferencesByUserId } from '../db/preferences';
import { getAllActiveUsers } from '../db/users';
import { getGlobalSetting } from '../db/settings';
import {
  getUnscoredArticlesForUser,
  createUserArticleScoring,
  setEmbeddingScore,
  getScoredUnassignedForUser,
  assignUserArticlesToDigest,
} from '../db/user-articles';
import {
  getEmbeddingsByType,
  cosineSimilarity,
  pruneOldArticleEmbeddings,
} from '../embeddings';
import { prefilterArticles } from './prefilter';
import { scoreArticles } from './scorer';
import { shouldRunLearning, runPreferenceLearning } from './learner';
import type { IngestionLogger } from '../ingestion/logger';
import type { Article } from '@/types';

// Default thresholds (overridden by global settings)
const DEFAULT_EMBEDDING_LLM_THRESHOLD = 0.35;
const DEFAULT_EMBEDDING_SERENDIPITY_MIN = 0.20;
const DEFAULT_EMBEDDING_SERENDIPITY_MAX = 0.35;
const DEFAULT_SERENDIPITY_SAMPLE_SIZE = 5;
const DEFAULT_MAX_LLM_CANDIDATES = 40;

interface EmbeddingThresholds {
  llmThreshold: number;
  serendipityMin: number;
  serendipityMax: number;
  serendipitySampleSize: number;
  maxLlmCandidates: number;
}

async function getThresholds(): Promise<EmbeddingThresholds> {
  const [t1, t2, t3, t4, t5] = await Promise.all([
    getGlobalSetting('embedding_llm_threshold'),
    getGlobalSetting('embedding_serendipity_min'),
    getGlobalSetting('embedding_serendipity_max'),
    getGlobalSetting('serendipity_sample_size'),
    getGlobalSetting('max_llm_candidates'),
  ]);
  return {
    llmThreshold: t1 ? parseFloat(t1) : DEFAULT_EMBEDDING_LLM_THRESHOLD,
    serendipityMin: t2 ? parseFloat(t2) : DEFAULT_EMBEDDING_SERENDIPITY_MIN,
    serendipityMax: t3 ? parseFloat(t3) : DEFAULT_EMBEDDING_SERENDIPITY_MAX,
    serendipitySampleSize: t4 ? parseInt(t4, 10) : DEFAULT_SERENDIPITY_SAMPLE_SIZE,
    maxLlmCandidates: t5 ? parseInt(t5, 10) : DEFAULT_MAX_LLM_CANDIDATES,
  };
}

interface RelevanceResult {
  articlesScored: number;
  digestId: string | null;
  digestArticleCount: number;
  unscoredCount: number;
  afterPrefilterCount: number;
  embeddingScored: number;
  aboveEmbeddingThreshold: number;
  serendipityCandidates: number;
  sentToLlm: number;
  scoredUnassignedCount: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  llmApiCalls: number;
}

export async function runRelevanceForAllUsers(provider: string, logger?: IngestionLogger): Promise<Record<string, RelevanceResult>> {
  const users = await getAllActiveUsers();
  const results: Record<string, RelevanceResult> = {};

  logger?.log('relevance', `Scoring for ${users.length} active user(s)`);

  for (const user of users) {
    try {
      results[user.id] = await runRelevanceEngine(user.id, provider, logger);
    } catch (error: unknown) {
      logger?.error('relevance', `Error scoring for user ${user.username}: ${error}`);
      results[user.id] = {
        articlesScored: 0,
        digestId: null,
        digestArticleCount: 0,
        unscoredCount: 0,
        afterPrefilterCount: 0,
        embeddingScored: 0,
        aboveEmbeddingThreshold: 0,
        serendipityCandidates: 0,
        sentToLlm: 0,
        scoredUnassignedCount: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        llmApiCalls: 0,
      };
    }
  }

  // Prune old article embeddings to save database storage
  try {
    const pruned = await pruneOldArticleEmbeddings(7);
    if (pruned > 0) {
      logger?.log('embedding', `Pruned ${pruned} old article embeddings (>7 days)`);
    }
  } catch (err) {
    logger?.warn('embedding', `Embedding pruning failed: ${err}`);
  }

  return results;
}

export async function runRelevanceEngine(userId: string, provider: string, logger?: IngestionLogger): Promise<RelevanceResult> {
  const result: RelevanceResult = {
    articlesScored: 0,
    digestId: null,
    digestArticleCount: 0,
    unscoredCount: 0,
    afterPrefilterCount: 0,
    embeddingScored: 0,
    aboveEmbeddingThreshold: 0,
    serendipityCandidates: 0,
    sentToLlm: 0,
    scoredUnassignedCount: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmApiCalls: 0,
  };

  const userSources = await getEnabledSourcesForUser(userId);
  const sourceIds = userSources.map(s => s.id);

  const unscored = await getUnscoredArticlesForUser(userId, sourceIds);
  result.unscoredCount = unscored.length;

  logger?.log('relevance', `User ${userId}: ${unscored.length} unscored articles`);

  if (unscored.length === 0) {
    const digestResult = await generateDigestForUser(userId, provider, logger);
    result.digestId = digestResult.digestId;
    result.digestArticleCount = digestResult.articleCount;
    result.scoredUnassignedCount = digestResult.scoredUnassignedCount;
    return result;
  }

  // Cast to Article shape for prefilter
  const asArticles = unscored.map(a => ({
    ...a,
    external_id: null,
    raw_content: a.raw_content,
    summary: null,
    provider,
    ingested_at: '',
  })) as Article[];

  const { kept: filtered, removed } = prefilterArticles(asArticles);
  result.afterPrefilterCount = filtered.length;

  logger?.log('prefilter', `Prefilter: ${unscored.length} → ${filtered.length} (${removed.length} removed)`);

  // Run preference learning if enough new feedback has accumulated
  if (await shouldRunLearning(userId)) {
    logger?.log('learning', `Running preference learning for user ${userId}`);
    const learned = await runPreferenceLearning(userId);
    logger?.log('learning', learned ? 'Preferences updated' : 'Preference learning skipped');
  }

  const interests = await getActiveInterestsByUserId(userId);
  const preferences = await getPreferencesByUserId(userId);
  const thresholds = await getThresholds();

  // --- Stage 1: Embedding pre-filter ---
  const interestEmbeddings = await getEmbeddingsByType('interest', interests.map(i => i.id));
  const articleIds = filtered.map(a => a.id);
  const articleEmbeddings = await getEmbeddingsByType('article', articleIds);

  const hasEmbeddings = interestEmbeddings.size > 0 && articleEmbeddings.size > 0;

  let llmCandidates: Article[];
  let serendipityPool: Article[] = [];

  if (hasEmbeddings) {
    // Compute embedding scores per article
    const embeddingScores: { article: Article; score: number }[] = [];

    for (const article of filtered) {
      const articleEmb = articleEmbeddings.get(article.id);
      if (!articleEmb) {
        // No embedding — send to LLM anyway
        embeddingScores.push({ article, score: 1.0 });
        continue;
      }

      let maxSimilarity = 0;
      for (const interest of interests) {
        const interestEmb = interestEmbeddings.get(interest.id);
        if (!interestEmb) continue;
        const similarity = cosineSimilarity(articleEmb, interestEmb);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      embeddingScores.push({ article, score: maxSimilarity });
      await setEmbeddingScore(userId, article.id, maxSimilarity);
    }

    result.embeddingScored = embeddingScores.length;

    // Log score distribution
    const distribution: Record<string, number> = {
      '0.0-0.1': 0, '0.1-0.2': 0, '0.2-0.3': 0, '0.3-0.4': 0,
      '0.4-0.5': 0, '0.5-0.6': 0, '0.6+': 0,
    };
    for (const { score } of embeddingScores) {
      if (score >= 0.6) distribution['0.6+']++;
      else if (score >= 0.5) distribution['0.5-0.6']++;
      else if (score >= 0.4) distribution['0.4-0.5']++;
      else if (score >= 0.3) distribution['0.3-0.4']++;
      else if (score >= 0.2) distribution['0.2-0.3']++;
      else if (score >= 0.1) distribution['0.1-0.2']++;
      else distribution['0.0-0.1']++;
    }
    logger?.log('embedding_scoring', `Score distribution: ${JSON.stringify(distribution)}`);

    // Select candidates above threshold
    const aboveThreshold = embeddingScores
      .filter(e => e.score >= thresholds.llmThreshold)
      .sort((a, b) => b.score - a.score);

    result.aboveEmbeddingThreshold = aboveThreshold.length;

    // Cap at max LLM candidates
    llmCandidates = aboveThreshold
      .slice(0, thresholds.maxLlmCandidates)
      .map(e => e.article);

    // Serendipity pool: random sample from below-threshold, above-floor articles
    const serendipityEligible = embeddingScores.filter(
      e => e.score >= thresholds.serendipityMin && e.score < thresholds.serendipityMax
    );

    // Fisher-Yates shuffle for random sample
    for (let i = serendipityEligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [serendipityEligible[i], serendipityEligible[j]] = [serendipityEligible[j], serendipityEligible[i]];
    }

    serendipityPool = serendipityEligible
      .slice(0, thresholds.serendipitySampleSize)
      .map(e => e.article);

    result.serendipityCandidates = serendipityPool.length;
    result.sentToLlm = llmCandidates.length + serendipityPool.length;

    logger?.log('embedding_scoring', `Embedding scored: ${embeddingScores.length}, above threshold (${thresholds.llmThreshold}): ${aboveThreshold.length}, serendipity candidates: ${serendipityPool.length}, total sent to LLM: ${result.sentToLlm}`);
  } else {
    // No embeddings available — fall back to sending all articles to LLM (old behavior)
    logger?.warn('embedding_scoring', 'No embeddings available — falling back to LLM-only scoring for all articles');
    llmCandidates = filtered;
    result.sentToLlm = filtered.length;
  }

  // --- Stage 2: LLM scoring (candidates only) ---
  if (llmCandidates.length > 0 || serendipityPool.length > 0) {
    const allCandidates = [...llmCandidates, ...serendipityPool];
    const { results: scores, usage } = await scoreArticles(allCandidates, interests, preferences, '', logger, serendipityPool.map(a => a.id));
    result.articlesScored = scores.length;
    result.llmInputTokens = usage.prompt_tokens;
    result.llmOutputTokens = usage.completion_tokens;
    result.llmApiCalls = usage.api_calls;

    logger?.log('scoring', `LLM scored ${scores.length} articles (${usage.total_tokens.toLocaleString()} tokens, ${usage.api_calls} API calls)`);

    for (const score of scores) {
      await createUserArticleScoring(
        userId,
        score.article_id,
        score.relevance_score,
        score.relevance_reason,
        score.is_serendipity
      );
    }
  }

  // Articles not sent to LLM get their embedding similarity as a fallback relevance score
  if (hasEmbeddings) {
    const llmScoredIds = new Set([...llmCandidates, ...serendipityPool].map(a => a.id));
    const unscoredByLlm = filtered.filter(a => !llmScoredIds.has(a.id));
    for (const article of unscoredByLlm) {
      const articleEmb = articleEmbeddings.get(article.id);
      if (!articleEmb) continue;

      // Use the article's best embedding similarity as its relevance score
      let maxSimilarity = 0;
      for (const interest of interests) {
        const interestEmb = interestEmbeddings.get(interest.id);
        if (!interestEmb) continue;
        const sim = cosineSimilarity(articleEmb, interestEmb);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }

      await createUserArticleScoring(
        userId,
        article.id,
        parseFloat(maxSimilarity.toFixed(4)),
        'Embedding score (not sent to LLM)',
        false
      );
    }
  }

  const digestResult = await generateDigestForUser(userId, provider, logger);
  result.digestId = digestResult.digestId;
  result.digestArticleCount = digestResult.articleCount;
  result.scoredUnassignedCount = digestResult.scoredUnassignedCount;

  return result;
}

// Bonus digest defaults
const DEFAULT_BONUS_MIN_SCORE = 0.15;
const DEFAULT_BONUS_MAX_ARTICLES = 50;

async function getBonusSettings(): Promise<{ enabled: boolean; minScore: number; maxArticles: number }> {
  const [enabled, minScore, maxArticles] = await Promise.all([
    getGlobalSetting('bonus_digest_enabled'),
    getGlobalSetting('bonus_min_score'),
    getGlobalSetting('bonus_max_articles'),
  ]);
  return {
    enabled: enabled !== 'false', // default true
    minScore: minScore ? parseFloat(minScore) : DEFAULT_BONUS_MIN_SCORE,
    maxArticles: maxArticles ? parseInt(maxArticles, 10) : DEFAULT_BONUS_MAX_ARTICLES,
  };
}

async function generateDigestForUser(userId: string, provider: string, logger?: IngestionLogger): Promise<{ digestId: string | null; articleCount: number; scoredUnassignedCount: number }> {
  const scored = await getScoredUnassignedForUser(userId);
  if (scored.length === 0) {
    logger?.log('digest', 'No scored articles available for digest');
    return { digestId: null, articleCount: 0, scoredUnassignedCount: 0 };
  }

  const minScore = config.minRelevanceScore;

  // Recommended: above relevance threshold
  const recommended = scored.filter(
    a => (a.relevance_score || 0) >= minScore && !a.is_serendipity
  );

  // Serendipity: flagged as serendipity with decent score
  const serendipityItems = scored.filter(
    a => a.is_serendipity && (a.relevance_score || 0) >= 0.4
  );

  // Combine recommended + serendipity (cap serendipity at 2)
  const selectedSerendipity = serendipityItems
    .filter(s => !recommended.find(r => r.article_id === s.article_id))
    .slice(0, 2);

  const mainDigest = [...recommended, ...selectedSerendipity];

  if (mainDigest.length === 0) {
    logger?.warn('digest', `No articles met threshold (${scored.length} scored, min ${minScore})`);
    return { digestId: null, articleCount: 0, scoredUnassignedCount: scored.length };
  }

  const digest = await createDigest(userId, mainDigest.length, provider);

  // Assign recommended articles
  const recommendedIds = recommended.map(a => a.article_id);
  if (recommendedIds.length > 0) {
    await assignUserArticlesToDigest(userId, recommendedIds, digest.id, 'recommended');
  }

  // Assign serendipity articles
  const serendipityIds = selectedSerendipity.map(a => a.article_id);
  if (serendipityIds.length > 0) {
    await assignUserArticlesToDigest(userId, serendipityIds, digest.id, 'serendipity');
  }

  // Bonus articles: below threshold but above floor, not already in main digest
  const bonusSettings = await getBonusSettings();
  let bonusCount = 0;

  if (bonusSettings.enabled) {
    const mainArticleIds = new Set(mainDigest.map(a => a.article_id));
    const bonusCandidates = scored
      .filter(a => {
        const score = a.relevance_score || 0;
        return !mainArticleIds.has(a.article_id)
          && score >= bonusSettings.minScore
          && score < minScore;
      })
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, bonusSettings.maxArticles);

    if (bonusCandidates.length > 0) {
      await assignUserArticlesToDigest(userId, bonusCandidates.map(a => a.article_id), digest.id, 'bonus');
      bonusCount = bonusCandidates.length;
    }
  }

  const totalCount = mainDigest.length + bonusCount;
  await updateDigestArticleCount(digest.id, totalCount);

  logger?.log('digest', `Digest created: ${recommended.length} recommended, ${selectedSerendipity.length} serendipity, ${bonusCount} bonus`);

  return { digestId: digest.id, articleCount: mainDigest.length, scoredUnassignedCount: scored.length };
}
