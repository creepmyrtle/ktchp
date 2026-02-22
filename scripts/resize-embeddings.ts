import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { sql } from '@vercel/postgres';
import { getDb } from '@/lib/db/index';
import { generateEmbeddings, storeEmbedding } from '@/lib/embeddings';
import { config } from '@/lib/config';

const DRY_RUN = process.argv.includes('--dry-run');
const targetDimsArg = process.argv.find(a => a.startsWith('--target-dims='));
const targetDims = targetDimsArg ? parseInt(targetDimsArg.split('=')[1], 10) : config.embeddingDimensions;

async function main() {
  await getDb();

  console.log(`Target embedding dimensions: ${targetDims}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'FULL RUN'}`);
  console.log();

  // Count current embeddings by type
  const { rows: counts } = await sql`
    SELECT ref_type, COUNT(*) as count FROM embeddings GROUP BY ref_type ORDER BY ref_type
  `;

  console.log('Current embedding counts:');
  for (const row of counts) {
    console.log(`  ${row.ref_type}: ${row.count}`);
  }

  // Check current column dimension
  const { rows: colInfo } = await sql`
    SELECT character_maximum_length, udt_name
    FROM information_schema.columns
    WHERE table_name = 'embeddings' AND column_name = 'embedding'
  `;
  if (colInfo.length > 0) {
    console.log(`\nCurrent vector column type: ${colInfo[0].udt_name}`);
  }

  // Estimate storage
  const { rows: sizeRows } = await sql`
    SELECT pg_total_relation_size('embeddings') as size_bytes
  `;
  const currentSizeMb = parseInt(sizeRows[0].size_bytes, 10) / (1024 * 1024);
  console.log(`Current embeddings table size: ${currentSizeMb.toFixed(2)} MB`);

  if (DRY_RUN) {
    const ratio = targetDims / 512;
    console.log(`\nEstimated size after resize: ~${(currentSizeMb * ratio).toFixed(2)} MB`);
    console.log(`Estimated savings: ~${(currentSizeMb * (1 - ratio)).toFixed(2)} MB`);
    console.log('\nRun without --dry-run to execute the migration.');
    process.exit(0);
  }

  // Re-generate all embeddings at new dimensions
  // Process interests first
  const { rows: interests } = await sql`
    SELECT e.ref_id, e.embedding_text
    FROM embeddings e
    WHERE e.ref_type = 'interest'
  `;

  if (interests.length > 0) {
    console.log(`\nRe-generating ${interests.length} interest embeddings...`);
    const texts = interests.map(i => i.embedding_text);
    const { embeddings, totalTokens } = await generateEmbeddings(texts);
    for (let i = 0; i < interests.length; i++) {
      await storeEmbedding('interest', interests[i].ref_id, interests[i].embedding_text, embeddings[i]);
    }
    console.log(`  Done (${totalTokens} tokens used)`);
  }

  // Exclusions
  const { rows: exclusions } = await sql`
    SELECT e.ref_id, e.embedding_text
    FROM embeddings e
    WHERE e.ref_type = 'exclusion'
  `;

  if (exclusions.length > 0) {
    console.log(`Re-generating ${exclusions.length} exclusion embeddings...`);
    const texts = exclusions.map(i => i.embedding_text);
    const { embeddings, totalTokens } = await generateEmbeddings(texts);
    for (let i = 0; i < exclusions.length; i++) {
      await storeEmbedding('exclusion', exclusions[i].ref_id, exclusions[i].embedding_text, embeddings[i]);
    }
    console.log(`  Done (${totalTokens} tokens used)`);
  }

  // Articles (batch in groups of 100)
  const { rows: articles } = await sql`
    SELECT e.ref_id, e.embedding_text
    FROM embeddings e
    WHERE e.ref_type = 'article'
  `;

  if (articles.length > 0) {
    console.log(`Re-generating ${articles.length} article embeddings...`);
    let totalArticleTokens = 0;
    for (let i = 0; i < articles.length; i += 100) {
      const batch = articles.slice(i, i + 100);
      const texts = batch.map(a => a.embedding_text);
      const { embeddings, totalTokens } = await generateEmbeddings(texts);
      for (let j = 0; j < batch.length; j++) {
        await storeEmbedding('article', batch[j].ref_id, batch[j].embedding_text, embeddings[j]);
      }
      totalArticleTokens += totalTokens;
      console.log(`  Batch ${Math.floor(i / 100) + 1}/${Math.ceil(articles.length / 100)} done`);
    }
    console.log(`  Done (${totalArticleTokens} tokens used)`);
  }

  // ALTER column type if dimensions changed
  try {
    await sql.query(`ALTER TABLE embeddings ALTER COLUMN embedding TYPE VECTOR(${targetDims})`);
    console.log(`\nVector column resized to VECTOR(${targetDims})`);
  } catch (err) {
    console.log(`\nNote: Could not alter vector column type (may already be correct): ${err}`);
  }

  // Report final size
  const { rows: finalSize } = await sql`
    SELECT pg_total_relation_size('embeddings') as size_bytes
  `;
  const finalSizeMb = parseInt(finalSize[0].size_bytes, 10) / (1024 * 1024);
  console.log(`\nFinal embeddings table size: ${finalSizeMb.toFixed(2)} MB`);
  console.log(`Savings: ${(currentSizeMb - finalSizeMb).toFixed(2)} MB`);

  process.exit(0);
}

main().catch(err => {
  console.error('Resize failed:', err);
  process.exit(1);
});
