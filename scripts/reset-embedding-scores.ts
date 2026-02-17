/**
 * Resets user_articles rows that were given a hardcoded 0.0 score
 * under the old "Below embedding threshold" logic.
 *
 * After running this, trigger an ingestion to re-score them with
 * actual embedding similarity scores.
 *
 * Usage:
 *   npx tsx scripts/reset-embedding-scores.ts [--dry-run]
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { sql } from '@vercel/postgres';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Count affected rows
  const { rows: countRows } = await sql`
    SELECT COUNT(*) as total
    FROM user_articles
    WHERE relevance_reason = 'Below embedding threshold'
      AND relevance_score = 0.0
  `;
  const total = parseInt(countRows[0].total, 10);
  console.log(`Found ${total} articles with stale 0.0 "Below embedding threshold" scores.`);

  if (total === 0) {
    console.log('Nothing to reset.');
    process.exit(0);
  }

  // Only reset articles that still have embeddings (so they can be re-scored cheaply)
  const { rows: withEmbRows } = await sql`
    SELECT COUNT(*) as total
    FROM user_articles ua
    JOIN embeddings e ON e.ref_type = 'article' AND e.ref_id = ua.article_id
    WHERE ua.relevance_reason = 'Below embedding threshold'
      AND ua.relevance_score = 0.0
  `;
  const withEmb = parseInt(withEmbRows[0].total, 10);
  const withoutEmb = total - withEmb;

  console.log(`  ${withEmb} still have embeddings (will be re-scored via embedding)`);
  console.log(`  ${withoutEmb} have expired embeddings (will be re-scored via LLM — more expensive)`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run without --dry-run to apply.');
    process.exit(0);
  }

  // Delete the user_articles rows so they'll be picked up as "unscored" on next ingestion
  const { rowCount } = await sql`
    DELETE FROM user_articles
    WHERE relevance_reason = 'Below embedding threshold'
      AND relevance_score = 0.0
  `;

  console.log(`\nDeleted ${rowCount} user_articles rows.`);
  console.log('Run an ingestion to re-score these articles with actual embedding similarity.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
