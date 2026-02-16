/**
 * Generates embeddings for all existing interests (and optionally articles)
 * that don't have embeddings yet.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts [--articles]
 *
 * --articles: Also backfill article embeddings (for articles already in the DB)
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { sql } from '@vercel/postgres';
import {
  generateEmbeddings,
  storeEmbedding,
  buildInterestEmbeddingText,
  buildArticleEmbeddingText,
  getArticleIdsWithEmbeddings,
} from '@/lib/embeddings';

async function backfillInterests() {
  console.log('--- Backfilling interest embeddings ---');

  const { rows: interests } = await sql`
    SELECT i.id, i.category, i.description
    FROM interests i
    WHERE NOT EXISTS (
      SELECT 1 FROM embeddings e WHERE e.ref_type = 'interest' AND e.ref_id = i.id
    )
  `;

  if (interests.length === 0) {
    console.log('All interests already have embeddings.');
    return;
  }

  console.log(`Found ${interests.length} interests without embeddings.`);

  const texts = interests.map(i => buildInterestEmbeddingText(i.category, i.description));
  const embeddings = await generateEmbeddings(texts);

  for (let i = 0; i < interests.length; i++) {
    await storeEmbedding('interest', interests[i].id, texts[i], embeddings[i]);
    console.log(`  Embedded: ${interests[i].category}`);
  }

  console.log(`Done. Embedded ${interests.length} interests.`);
}

async function backfillArticles() {
  console.log('\n--- Backfilling article embeddings ---');

  const { rows: articles } = await sql`
    SELECT a.id, a.title, a.raw_content
    FROM articles a
    WHERE NOT EXISTS (
      SELECT 1 FROM embeddings e WHERE e.ref_type = 'article' AND e.ref_id = a.id
    )
    ORDER BY a.ingested_at DESC
  `;

  if (articles.length === 0) {
    console.log('All articles already have embeddings.');
    return;
  }

  console.log(`Found ${articles.length} articles without embeddings.`);

  // Batch in groups of 500 to avoid huge single API calls
  const BATCH_SIZE = 500;
  let embedded = 0;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const texts = batch.map(a => buildArticleEmbeddingText(a.title, a.raw_content));
    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      await storeEmbedding('article', batch[j].id, texts[j], embeddings[j]);
      embedded++;
    }

    console.log(`  Embedded ${embedded}/${articles.length} articles`);
  }

  console.log(`Done. Embedded ${articles.length} articles.`);
}

async function main() {
  const includeArticles = process.argv.includes('--articles');

  await backfillInterests();

  if (includeArticles) {
    await backfillArticles();
  } else {
    console.log('\nSkipping article backfill. Use --articles to include.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
