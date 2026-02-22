import { existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local if it exists (local dev); in GitHub Actions, env vars come from secrets
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { seedDatabase } from '@/lib/db/seed';
import { getDefaultUser } from '@/lib/db/users';
import { markStaleLogsAsTimedOut } from '@/lib/db/ingestion-logs';
import { runIngestion } from '@/lib/ingestion';
import { runRelevanceForAllUsers } from '@/lib/relevance';
import { getActiveProvider } from '@/lib/llm';
import { IngestionLogger } from '@/lib/ingestion/logger';

async function main() {
  // Ensure DB is seeded (idempotent)
  await seedDatabase();

  // Clean up any stale "running" logs from previous crashes/timeouts
  const staleCount = await markStaleLogsAsTimedOut();
  if (staleCount > 0) {
    console.log(`Marked ${staleCount} stale running log(s) as timed out`);
  }

  const user = await getDefaultUser();
  if (!user) throw new Error('No user found');

  const provider = await getActiveProvider();

  const logger = new IngestionLogger(user.id, provider, 'cron');
  await logger.init();

  logger.log('setup', `Ingestion started (provider: ${provider})`);

  try {
    const ingestionResult = await runIngestion(provider, logger);

    let allResults: Record<string, unknown> = {};
    if (ingestionResult.newArticles > 0) {
      allResults = await runRelevanceForAllUsers(provider, logger);
    } else {
      logger.log('relevance', 'Skipping relevance engine: no new articles');
    }

    const summary = {
      totalFetched: ingestionResult.totalFetched,
      newArticles: ingestionResult.newArticles,
      duplicates: ingestionResult.duplicates,
      articlesEmbedded: ingestionResult.articlesEmbedded,
      embeddingTokens: ingestionResult.embeddingTokens,
      errorCount: ingestionResult.errors.length,
      userResults: allResults,
    };

    logger.log('complete', 'Pipeline finished', summary);
    await logger.persist('success', summary);

    // Run retention cleanup (non-blocking — failure doesn't break pipeline)
    try {
      const { runRetention } = await import('@/lib/db/retention');
      const retention = await runRetention();
      const totalCleaned = Object.values(retention).reduce((a, b) => a + b, 0);
      logger.log('retention', `Retention cleanup: ${totalCleaned} rows removed`, retention as unknown as Record<string, unknown>);
      console.log('Retention cleanup:', totalCleaned > 0 ? JSON.stringify(retention) : '0 rows (nothing old enough)');
    } catch (retentionErr) {
      console.warn('Retention cleanup failed (non-fatal):', retentionErr);
    }

    console.log('Ingestion complete:', JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Ingestion error:', error);

    logger.error('pipeline', 'Pipeline failed', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await logger.persist('error', {}, String(error));

    process.exit(1);
  }
}

main();
