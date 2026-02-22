import { sql } from '@vercel/postgres';

const RETENTION_INGESTION_LOGS_DAYS = 30;
const RETENTION_FEEDBACK_DAYS = 90;
const RETENTION_USER_ARTICLES_DAYS = 60;
const RETENTION_DIGESTS_DAYS = 90;
const RETENTION_DISMISSED_SUGGESTIONS_DAYS = 30;

export interface RetentionResult {
  ingestion_logs_deleted: number;
  feedback_deleted: number;
  user_articles_detached: number;
  user_articles_deleted: number;
  user_articles_scores_cleared: number;
  digests_deleted: number;
  orphan_articles_deleted: number;
  orphan_embeddings_deleted: number;
  dismissed_suggestions_deleted: number;
}

export async function runRetention(): Promise<RetentionResult> {
  const result: RetentionResult = {
    ingestion_logs_deleted: 0,
    feedback_deleted: 0,
    user_articles_detached: 0,
    user_articles_deleted: 0,
    user_articles_scores_cleared: 0,
    digests_deleted: 0,
    orphan_articles_deleted: 0,
    orphan_embeddings_deleted: 0,
    dismissed_suggestions_deleted: 0,
  };

  // 1. Ingestion logs — DELETE where started_at older than 30 days
  const { rowCount: logsDeleted } = await sql`
    DELETE FROM ingestion_logs
    WHERE started_at < NOW() - INTERVAL '1 day' * ${RETENTION_INGESTION_LOGS_DAYS}
  `;
  result.ingestion_logs_deleted = logsDeleted ?? 0;

  // 2. Feedback — DELETE where created_at older than 90 days
  const { rowCount: feedbackDeleted } = await sql`
    DELETE FROM feedback
    WHERE created_at < NOW() - INTERVAL '1 day' * ${RETENTION_FEEDBACK_DAYS}
  `;
  result.feedback_deleted = feedbackDeleted ?? 0;

  // 3a. Detach interacted articles from old digests: UPDATE digest_id = NULL
  // where digest is >60 days old AND user has interacted (sentiment, bookmarked, or read)
  const { rowCount: detached } = await sql`
    UPDATE user_articles ua
    SET digest_id = NULL
    WHERE ua.digest_id IS NOT NULL
      AND ua.digest_id IN (
        SELECT d.id FROM digests d
        WHERE d.generated_at < NOW() - INTERVAL '1 day' * ${RETENTION_USER_ARTICLES_DAYS}
      )
      AND (ua.sentiment IS NOT NULL OR ua.is_bookmarked = TRUE OR ua.is_read = TRUE)
  `;
  result.user_articles_detached = detached ?? 0;

  // 3b. DELETE non-interacted user_articles from old digests
  const { rowCount: uaDeleted } = await sql`
    DELETE FROM user_articles
    WHERE digest_id IS NOT NULL
      AND digest_id IN (
        SELECT d.id FROM digests d
        WHERE d.generated_at < NOW() - INTERVAL '1 day' * ${RETENTION_USER_ARTICLES_DAYS}
      )
      AND sentiment IS NULL
      AND is_bookmarked = FALSE
      AND is_read = FALSE
  `;
  result.user_articles_deleted = uaDeleted ?? 0;

  // 3c. NULL out scoring columns on detached interacted rows where scored_at is old
  const { rowCount: scoresCleared } = await sql`
    UPDATE user_articles
    SET relevance_score = NULL,
        relevance_reason = NULL,
        is_serendipity = FALSE,
        embedding_score = NULL,
        digest_tier = NULL,
        scored_at = NULL
    WHERE digest_id IS NULL
      AND scored_at IS NOT NULL
      AND scored_at < NOW() - INTERVAL '1 day' * ${RETENTION_USER_ARTICLES_DAYS}
      AND (sentiment IS NOT NULL OR is_bookmarked = TRUE OR is_read = TRUE)
  `;
  result.user_articles_scores_cleared = scoresCleared ?? 0;

  // 4a. NULL out remaining digest_id refs for digests >90 days (safety for FK)
  await sql`
    UPDATE user_articles
    SET digest_id = NULL
    WHERE digest_id IN (
      SELECT d.id FROM digests d
      WHERE d.generated_at < NOW() - INTERVAL '1 day' * ${RETENTION_DIGESTS_DAYS}
    )
  `;

  // 4b. DELETE old digests
  const { rowCount: digestsDeleted } = await sql`
    DELETE FROM digests
    WHERE generated_at < NOW() - INTERVAL '1 day' * ${RETENTION_DIGESTS_DAYS}
  `;
  result.digests_deleted = digestsDeleted ?? 0;

  // 4c. DELETE orphaned articles (no user_articles refs AND >90 days old)
  const { rowCount: orphanArticles } = await sql`
    DELETE FROM articles a
    WHERE a.ingested_at < NOW() - INTERVAL '1 day' * ${RETENTION_DIGESTS_DAYS}
      AND NOT EXISTS (SELECT 1 FROM user_articles ua WHERE ua.article_id = a.id)
  `;
  result.orphan_articles_deleted = orphanArticles ?? 0;

  // 4d. DELETE orphaned article embeddings (ref_type='article' with no matching article)
  const { rowCount: orphanEmb } = await sql`
    DELETE FROM embeddings e
    WHERE e.ref_type = 'article'
      AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = e.ref_id)
  `;
  result.orphan_embeddings_deleted = orphanEmb ?? 0;

  // 5. Dismissed suggestions — DELETE where status='dismissed' AND >30 days old
  const { rowCount: suggestionsDeleted } = await sql`
    DELETE FROM interest_suggestions
    WHERE status = 'dismissed'
      AND resolved_at < NOW() - INTERVAL '1 day' * ${RETENTION_DISMISSED_SUGGESTIONS_DAYS}
  `;
  result.dismissed_suggestions_deleted = suggestionsDeleted ?? 0;

  return result;
}
