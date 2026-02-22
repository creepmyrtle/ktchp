import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireCronOrAuth } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';
import { runIngestion } from '@/lib/ingestion';
import { runRelevanceForAllUsers, runRelevanceEngine } from '@/lib/relevance';
import { getActiveProvider } from '@/lib/llm';
import { IngestionLogger } from '@/lib/ingestion/logger';
import { getUserById } from '@/lib/db/users';

export const maxDuration = 300; // 5 minute timeout

export async function GET(request: Request) {
  return handleIngest(request);
}

export async function POST(request: Request) {
  return handleIngest(request);
}

async function handleIngest(request: Request) {
  let logger: IngestionLogger | undefined;

  try {
    // Check auth: either CRON_SECRET or session token
    const cronResult = await requireCronOrAuth(request);
    const isCron = cronResult === 'all_users';
    let userId = isCron ? null : await getSessionFromCookies();

    if (!isCron && !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure DB is seeded
    await seedDatabase();

    // Get current provider for tagging
    const provider = await getActiveProvider();

    // Create logger — use the session user or a system-level log
    const logUserId = userId || 'system';
    const trigger = isCron ? 'cron' : 'manual';

    // For logger, we need a real user id. Get the first admin if cron.
    let loggerUserId = userId;
    if (!loggerUserId) {
      const { getAllActiveUsers } = await import('@/lib/db/users');
      const users = await getAllActiveUsers();
      loggerUserId = users[0]?.id || null;
    }

    if (loggerUserId) {
      logger = new IngestionLogger(loggerUserId, provider, trigger);
      await logger.init();
      logger.log('setup', `Ingestion started (${trigger}, provider: ${provider})`);
    }

    // Fetch once for all sources
    const ingestionResult = await runIngestion(provider, logger);

    // Score for users
    let digestResults: Record<string, unknown> = {};
    if (ingestionResult.newArticles > 0 || isCron) {
      if (isCron) {
        // Score for all active users
        digestResults = await runRelevanceForAllUsers(provider, logger);
      } else if (userId) {
        // Score for the triggering user only
        const userResult = await runRelevanceEngine(userId, provider, logger);
        digestResults = { [userId]: userResult };
      }
    } else {
      logger?.log('relevance', 'Skipping relevance engine: no new articles');
    }

    const summary = {
      totalFetched: ingestionResult.totalFetched,
      newArticles: ingestionResult.newArticles,
      duplicates: ingestionResult.duplicates,
      articlesEmbedded: ingestionResult.articlesEmbedded,
      embeddingTokens: ingestionResult.embeddingTokens,
      errorCount: ingestionResult.errors.length,
      userResults: digestResults,
    };

    logger?.log('complete', 'Pipeline finished');
    if (logger) {
      await logger.persist('success', summary);
    }

    // Run retention cleanup (non-blocking — failure doesn't break pipeline)
    try {
      const { runRetention } = await import('@/lib/db/retention');
      const retention = await runRetention();
      const totalCleaned = Object.values(retention).reduce((a, b) => a + b, 0);
      logger?.log('retention', `Retention cleanup: ${totalCleaned} rows removed`, retention as unknown as Record<string, unknown>);
    } catch (retentionErr) {
      console.warn('Retention cleanup failed (non-fatal):', retentionErr);
    }

    return NextResponse.json({
      success: true,
      provider,
      ingestion: ingestionResult,
      userResults: digestResults,
    });
  } catch (error) {
    console.error('Ingestion error:', error);

    if (logger) {
      logger.error('pipeline', `Pipeline failed: ${error}`);
      await logger.persist('error', {}, String(error));
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
