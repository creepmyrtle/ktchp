import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireCronOrAuth } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { seedDatabase } from '@/lib/db/seed';
import { runIngestion } from '@/lib/ingestion';
import { runRelevanceEngine } from '@/lib/relevance';
import { getActiveProvider } from '@/lib/llm';
import { IngestionLogger } from '@/lib/ingestion/logger';
import { config } from '@/lib/config';

export const maxDuration = 300; // 5 minute timeout

export async function POST(request: Request) {
  let logger: IngestionLogger | undefined;

  try {
    // Check auth: either CRON_SECRET or session token
    const cronUserId = await requireCronOrAuth(request);
    const isCron = !!cronUserId;
    let userId = cronUserId;
    if (!userId) {
      userId = await getSessionFromCookies();
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure DB is seeded
    await seedDatabase();

    const user = await getDefaultUser();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 500 });
    }

    // Get current provider for tagging
    const provider = await getActiveProvider();

    // Create logger
    const trigger = isCron ? 'cron' : 'manual';
    logger = new IngestionLogger(user.id, provider, trigger);
    await logger.init();

    // Log setup/config
    logger.log('setup', 'Ingestion started', {
      trigger,
      userId: user.id,
      provider,
      model: provider === 'synthetic' ? config.syntheticModel : config.claudeModel,
      config: {
        batchSize: config.batchSize,
        minRelevanceScore: config.minRelevanceScore,
      },
    });

    // Run ingestion
    const ingestionResult = await runIngestion(user.id, provider, logger);

    // Run relevance engine if new articles were ingested
    let digestResult = null;
    if (ingestionResult.newArticles > 0) {
      digestResult = await runRelevanceEngine(user.id, provider, logger);
    } else {
      logger.log('relevance', 'Skipping relevance engine: no new articles');
    }

    const summary = {
      totalFetched: ingestionResult.totalFetched,
      newArticles: ingestionResult.newArticles,
      duplicates: ingestionResult.duplicates,
      errorCount: ingestionResult.errors.length,
      articlesScored: digestResult?.articlesScored ?? 0,
      digestId: digestResult?.digestId ?? null,
      digestArticleCount: digestResult?.digestArticleCount ?? 0,
    };

    // Log final summary
    logger.log('complete', 'Pipeline finished', summary);

    // Persist success log
    await logger.persist('success', summary);

    return NextResponse.json({
      success: true,
      provider,
      ingestion: ingestionResult,
      digest: digestResult,
    });
  } catch (error) {
    console.error('Ingestion error:', error);

    // Persist error log with stack trace
    if (logger) {
      logger.error('pipeline', 'Pipeline failed', {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await logger.persist('error', {}, String(error));
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
