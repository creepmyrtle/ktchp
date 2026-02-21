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
  generateEmbedding,
  storeEmbedding,
  buildInterestEmbeddingText,
} from '../embeddings';
import { getExclusionsByUserId } from '../db/exclusions';
import { prefilterArticles } from './prefilter';
import { scoreArticles } from './scorer';
import { shouldRunLearning, runPreferenceLearning } from './learner';
import { getSourceTrustFactors } from '../db/source-trust';
import { runAffinityAnalysis } from '../affinity';
import { recomputeSourceTrust } from '../source-trust';
import type { IngestionLogger } from '../ingestion/logger';
import type { Article } from '@/types';

// Default thresholds (overridden by global settings)
const DEFAULT_EMBEDDING_LLM_THRESHOLD = 0.28;
const DEFAULT_EMBEDDING_SERENDIPITY_MIN = 0.20;
const DEFAULT_EMBEDDING_SERENDIPITY_MAX = 0.35;
const DEFAULT_SERENDIPITY_SAMPLE_SIZE = 5;
const DEFAULT_MAX_LLM_CANDIDATES = 40;
const DEFAULT_EXCLUSION_PENALTY_THRESHOLD = 0.40;

interface EmbeddingThresholds {
  llmThreshold: number;
  serendipityMin: number;
  serendipityMax: number;
  serendipitySampleSize: number;
  maxLlmCandidates: number;
  blendedPrimaryWeight: number;
  blendedSecondaryWeight: number;
}

async function getThresholds(): Promise<EmbeddingThresholds> {
  const [t1, t2, t3, t4, t5, t6, t7] = await Promise.all([
    getGlobalSetting('embedding_llm_threshold'),
    getGlobalSetting('embedding_serendipity_min'),
    getGlobalSetting('embedding_serendipity_max'),
    getGlobalSetting('serendipity_sample_size'),
    getGlobalSetting('max_llm_candidates'),
    getGlobalSetting('blended_primary_weight'),
    getGlobalSetting('blended_secondary_weight'),
  ]);
  return {
    llmThreshold: t1 ? parseFloat(t1) : DEFAULT_EMBEDDING_LLM_THRESHOLD,
    serendipityMin: t2 ? parseFloat(t2) : DEFAULT_EMBEDDING_SERENDIPITY_MIN,
    serendipityMax: t3 ? parseFloat(t3) : DEFAULT_EMBEDDING_SERENDIPITY_MAX,
    serendipitySampleSize: t4 ? parseInt(t4, 10) : DEFAULT_SERENDIPITY_SAMPLE_SIZE,
    maxLlmCandidates: t5 ? parseInt(t5, 10) : DEFAULT_MAX_LLM_CANDIDATES,
    blendedPrimaryWeight: t6 ? parseFloat(t6) : 0.7,
    blendedSecondaryWeight: t7 ? parseFloat(t7) : 0.3,
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

  // Weekly analysis: affinity mapping + source trust (runs on configurable day, default Sunday)
  const affinityDaySetting = await getGlobalSetting('affinity_analysis_day');
  const affinityDay = affinityDaySetting !== null ? parseInt(affinityDaySetting, 10) : 0;
  const today = new Date();
  if (today.getUTCDay() === affinityDay) {
    logger?.log('weekly', 'Running weekly analysis (affinity + source trust)');
    for (const user of users) {
      try {
        const count = await runAffinityAnalysis(user.id, logger);
        if (count > 0) {
          logger?.log('affinity', `User ${user.username}: ${count} suggestion(s) created`);
        }
      } catch (err) {
        logger?.warn('affinity', `Affinity analysis failed for ${user.username}: ${err}`);
      }
      try {
        await recomputeSourceTrust(user.id, logger);
      } catch (err) {
        logger?.warn('source_trust', `Source trust update failed for ${user.username}: ${err}`);
      }
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

  // --- Ensure interest embeddings are up to date ---
  const existingInterestEmbeddings = await getEmbeddingsByType('interest', interests.map(i => i.id));
  const missingInterests = interests.filter(i => !existingInterestEmbeddings.has(i.id));
  if (missingInterests.length > 0) {
    logger?.log('embedding', `Generating embeddings for ${missingInterests.length} interest(s)`);
    for (const interest of missingInterests) {
      try {
        const text = buildInterestEmbeddingText(interest.category, interest.description, interest.expanded_description);
        const emb = await generateEmbedding(text);
        await storeEmbedding('interest', interest.id, text, emb);
        existingInterestEmbeddings.set(interest.id, emb);
      } catch (err) {
        logger?.warn('embedding', `Failed to generate embedding for interest "${interest.category}": ${err}`);
      }
    }
  }

  // --- Load exclusion embeddings ---
  const exclusions = await getExclusionsByUserId(userId);
  const exclusionEmbeddings = exclusions.length > 0
    ? await getEmbeddingsByType('exclusion', exclusions.map(e => e.id))
    : new Map<string, number[]>();

  const exclusionThresholdSetting = await getGlobalSetting('exclusion_penalty_threshold');
  const exclusionThreshold = exclusionThresholdSetting ? parseFloat(exclusionThresholdSetting) : DEFAULT_EXCLUSION_PENALTY_THRESHOLD;

  if (exclusionEmbeddings.size > 0) {
    logger?.log('embedding_scoring', `Loaded ${exclusionEmbeddings.size} exclusion embedding(s)`);
  }

  // --- Load source trust factors ---
  const sourceTrustFactors = await getSourceTrustFactors(userId);

  // --- Stage 1: Embedding pre-filter ---
  const interestEmbeddings = existingInterestEmbeddings;
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

      // Compute weight-adjusted similarities per interest
      const weightedSims: number[] = [];
      for (const interest of interests) {
        if (interest.weight === 0) continue;
        const interestEmb = interestEmbeddings.get(interest.id);
        if (!interestEmb) continue;
        const similarity = cosineSimilarity(articleEmb, interestEmb);
        weightedSims.push(similarity * interest.weight);
      }

      // Blended scoring: 0.7 * primary + 0.3 * avg(top 3)
      weightedSims.sort((a, b) => b - a);
      const primary = weightedSims[0] ?? 0;
      const topN = weightedSims.slice(0, 3);
      const secondary = topN.length > 0 ? topN.reduce((s, v) => s + v, 0) / topN.length : 0;
      let blended = thresholds.blendedPrimaryWeight * primary + thresholds.blendedSecondaryWeight * secondary;

      // Apply exclusion penalties
      if (exclusionEmbeddings.size > 0) {
        let penaltyMultiplier = 1.0;
        for (const [, excEmb] of exclusionEmbeddings) {
          const sim = cosineSimilarity(articleEmb, excEmb);
          if (sim >= exclusionThreshold) {
            const penaltyStrength = (sim - exclusionThreshold) / (1.0 - exclusionThreshold);
            penaltyMultiplier = Math.min(penaltyMultiplier, 1.0 - (penaltyStrength * 0.8));
          }
        }
        blended *= penaltyMultiplier;
      }

      // Apply source trust multiplier
      const trustFactor = sourceTrustFactors.get(article.source_id) ?? 1.0;
      blended *= trustFactor;

      embeddingScores.push({ article, score: blended });
      await setEmbeddingScore(userId, article.id, blended);
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

    // Serendipity pool: weighted sample biased toward threshold proximity and diversity
    const serendipityEligible = embeddingScores.filter(
      e => e.score >= thresholds.serendipityMin && e.score < thresholds.serendipityMax
    );

    if (serendipityEligible.length > 0) {
      // Count interest/source coverage in LLM candidates for diversity bias
      const interestCoverage = new Map<string, number>();
      const sourceCoverage = new Map<string, number>();
      for (const candidate of llmCandidates) {
        // Best matching interest for this candidate
        let bestInterest = '';
        let bestSim = 0;
        for (const interest of interests) {
          const interestEmb = interestEmbeddings.get(interest.id);
          const articleEmb = articleEmbeddings.get(candidate.id);
          if (!interestEmb || !articleEmb) continue;
          const sim = cosineSimilarity(articleEmb, interestEmb);
          if (sim > bestSim) { bestSim = sim; bestInterest = interest.id; }
        }
        if (bestInterest) interestCoverage.set(bestInterest, (interestCoverage.get(bestInterest) || 0) + 1);
        sourceCoverage.set(candidate.source_id, (sourceCoverage.get(candidate.source_id) || 0) + 1);
      }

      const range = thresholds.serendipityMax - thresholds.serendipityMin;

      // Compute selection weights
      const weighted = serendipityEligible.map(e => {
        // A. Score proximity to threshold (quadratic bias)
        const position = range > 0 ? (e.score - thresholds.serendipityMin) / range : 0;
        const proximityWeight = position * position;

        // B. Interest diversity
        let bestInterest = '';
        let bestSim = 0;
        const articleEmb = articleEmbeddings.get(e.article.id);
        if (articleEmb) {
          for (const interest of interests) {
            const interestEmb = interestEmbeddings.get(interest.id);
            if (!interestEmb) continue;
            const sim = cosineSimilarity(articleEmb, interestEmb);
            if (sim > bestSim) { bestSim = sim; bestInterest = interest.id; }
          }
        }
        const coverage = interestCoverage.get(bestInterest) || 0;
        const diversityWeight = 1.0 / (1 + coverage);

        // C. Source diversity
        const sourceCount = sourceCoverage.get(e.article.source_id) || 0;
        const sourceWeight = 1.0 / (1 + sourceCount);

        const selectionWeight = (0.5 * proximityWeight) + (0.3 * diversityWeight) + (0.2 * sourceWeight);
        return { ...e, selectionWeight };
      });

      // Weighted random sampling (roulette wheel)
      const selected: typeof serendipityEligible = [];
      const remaining = [...weighted];
      const sampleSize = Math.min(thresholds.serendipitySampleSize, remaining.length);

      for (let s = 0; s < sampleSize; s++) {
        const totalWeight = remaining.reduce((sum, e) => sum + e.selectionWeight, 0);
        if (totalWeight <= 0) break;
        let r = Math.random() * totalWeight;
        let picked = remaining.length - 1;
        for (let i = 0; i < remaining.length; i++) {
          r -= remaining[i].selectionWeight;
          if (r <= 0) { picked = i; break; }
        }
        selected.push(remaining[picked]);
        remaining.splice(picked, 1);
      }

      serendipityPool = selected.map(e => e.article);
    }

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

      // Use weight-adjusted blended embedding similarity as fallback relevance score
      const weightedSims: number[] = [];
      for (const interest of interests) {
        if (interest.weight === 0) continue;
        const interestEmb = interestEmbeddings.get(interest.id);
        if (!interestEmb) continue;
        const sim = cosineSimilarity(articleEmb, interestEmb);
        weightedSims.push(sim * interest.weight);
      }

      weightedSims.sort((a, b) => b - a);
      const primary = weightedSims[0] ?? 0;
      const topN = weightedSims.slice(0, 3);
      const secondary = topN.length > 0 ? topN.reduce((s, v) => s + v, 0) / topN.length : 0;
      let blended = thresholds.blendedPrimaryWeight * primary + thresholds.blendedSecondaryWeight * secondary;

      // Apply exclusion penalties
      if (exclusionEmbeddings.size > 0) {
        let penaltyMultiplier = 1.0;
        for (const [, excEmb] of exclusionEmbeddings) {
          const sim = cosineSimilarity(articleEmb, excEmb);
          if (sim >= exclusionThreshold) {
            const penaltyStrength = (sim - exclusionThreshold) / (1.0 - exclusionThreshold);
            penaltyMultiplier = Math.min(penaltyMultiplier, 1.0 - (penaltyStrength * 0.8));
          }
        }
        blended *= penaltyMultiplier;
      }

      // Apply source trust multiplier
      const trustFactor = sourceTrustFactors.get(article.source_id) ?? 1.0;
      blended *= trustFactor;

      await createUserArticleScoring(
        userId,
        article.id,
        parseFloat(blended.toFixed(4)),
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
