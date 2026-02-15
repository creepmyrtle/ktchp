import { config } from '../config';
import { getEnabledSourcesForUser } from '../db/sources';
import { createDigest, updateDigestArticleCount } from '../db/digests';
import { getActiveInterestsByUserId } from '../db/interests';
import { getPreferencesByUserId } from '../db/preferences';
import { getAllActiveUsers } from '../db/users';
import {
  getUnscoredArticlesForUser,
  createUserArticleScoring,
  getScoredUnassignedForUser,
  assignUserArticlesToDigest,
} from '../db/user-articles';
import { prefilterArticles } from './prefilter';
import { scoreArticles } from './scorer';
import { shouldRunLearning, runPreferenceLearning } from './learner';
import type { IngestionLogger } from '../ingestion/logger';
import type { Article } from '@/types';

interface RelevanceResult {
  articlesScored: number;
  digestId: string | null;
  digestArticleCount: number;
  unscoredCount: number;
  afterPrefilterCount: number;
  scoredUnassignedCount: number;
}

export async function runRelevanceForAllUsers(provider: string, logger?: IngestionLogger): Promise<Record<string, RelevanceResult>> {
  const users = await getAllActiveUsers();
  const results: Record<string, RelevanceResult> = {};

  logger?.log('relevance', `Scoring for ${users.length} active user(s)`);

  for (const user of users) {
    try {
      results[user.id] = await runRelevanceEngine(user.id, provider, logger);
    } catch (error) {
      logger?.error('relevance', `Error scoring for user ${user.username}: ${error}`);
      results[user.id] = {
        articlesScored: 0,
        digestId: null,
        digestArticleCount: 0,
        unscoredCount: 0,
        afterPrefilterCount: 0,
        scoredUnassignedCount: 0,
      };
    }
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
    scoredUnassignedCount: 0,
  };

  const userSources = await getEnabledSourcesForUser(userId);
  const sourceIds = userSources.map(s => s.id);

  const unscored = await getUnscoredArticlesForUser(userId, sourceIds);
  result.unscoredCount = unscored.length;

  logger?.log('relevance', `User ${userId}: ${unscored.length} unscored articles`);

  if (unscored.length === 0) {
    // Still try to generate digest from previously scored but unassigned
    const digestResult = await generateDigestForUser(userId, provider, logger);
    result.digestId = digestResult.digestId;
    result.digestArticleCount = digestResult.articleCount;
    result.scoredUnassignedCount = digestResult.scoredUnassignedCount;
    return result;
  }

  // Cast to Article shape for prefilter (it only needs title, url, published_at)
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

  const scores = await scoreArticles(filtered, interests, preferences, '', logger);
  result.articlesScored = scores.length;

  logger?.log('scoring', `Scored ${scores.length} articles`);

  for (const score of scores) {
    await createUserArticleScoring(
      userId,
      score.article_id,
      score.relevance_score,
      score.relevance_reason,
      score.is_serendipity
    );
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
