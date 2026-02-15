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
import { runRelevanceEngine } from '@/lib/relevance';
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
    const ingestionResult = await runIngestion(user.id, provider, logger);

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

    logger.log('complete', 'Pipeline finished', summary);
    await logger.persist('success', summary);

    console.log('Ingestion complete:', JSON.stringify(summary, null, 2));
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
