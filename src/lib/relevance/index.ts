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
    const scores = await scoreArticles(allCandidates, interests, preferences, '', logger, serendipityPool.map(a => a.id));
    result.articlesScored = scores.length;

    logger?.log('scoring', `LLM scored ${scores.length} articles`);

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

  // Articles that passed embedding but weren't sent to LLM (above cap) get embedding_score as fallback
  if (hasEmbeddings) {
    const llmScoredIds = new Set([...llmCandidates, ...serendipityPool].map(a => a.id));
    const unscoredByLlm = filtered.filter(a => !llmScoredIds.has(a.id));
    for (const article of unscoredByLlm) {
      const emb = articleEmbeddings.get(article.id);
      if (!emb) continue;
      // These articles were below threshold or beyond cap — give them a fallback score
      // based on their embedding score (mapped to a relevance-like range)
      await createUserArticleScoring(
        userId,
        article.id,
        0.0, // Below threshold — score as not relevant
        'Below embedding threshold',
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

async function generateDigestForUser(userId: string, provider: string, logger?: IngestionLogger): Promise<{ digestId: string | null; articleCount: number; scoredUnassignedCount: number }> {
  const scored = await getScoredUnassignedForUser(userId);
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
    if (!selected.find(s => s.article_id === item.article_id)) {
      selected.push(item);
    }
  }

  if (selected.length === 0) {
    logger?.warn('digest', `No articles met threshold (${scored.length} scored, min ${minScore})`);
    return { digestId: null, articleCount: 0, scoredUnassignedCount: scored.length };
  }

  const digest = await createDigest(userId, selected.length, provider);
  await assignUserArticlesToDigest(userId, selected.map(a => a.article_id), digest.id);
  await updateDigestArticleCount(digest.id, selected.length);

  const serendipityCount = serendipityItems.filter(s => selected.find(sel => sel.article_id === s.article_id)).length;
  logger?.log('digest', `Digest created: ${selected.length} articles (${serendipityCount} serendipity)`);

  return { digestId: digest.id, articleCount: selected.length, scoredUnassignedCount: scored.length };
}
