/**
 * Creates a new digest for the admin user from scored, non-archived articles
 * that aren't already assigned to a digest.
 *
 * Usage:
 *   npx tsx scripts/make-digest.ts
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { sql } from '@vercel/postgres';

async function main() {
  // Get admin user
  const { rows: users } = await sql`
    SELECT id, username, display_name FROM users WHERE is_admin = TRUE LIMIT 1
  `;
  if (users.length === 0) {
    console.error('No admin user found');
    process.exit(1);
  }
  const user = users[0];
  console.log(`Admin user: ${user.display_name || user.username} (${user.id})`);

  // Find scored, non-archived articles not in any digest
  const { rows: candidates } = await sql`
    SELECT ua.article_id, ua.relevance_score, ua.is_serendipity, a.title
    FROM user_articles ua
    JOIN articles a ON ua.article_id = a.id
    WHERE ua.user_id = ${user.id}
      AND ua.relevance_score IS NOT NULL
      AND ua.is_archived = FALSE
      AND ua.digest_id IS NULL
    ORDER BY ua.relevance_score DESC
  `;

  if (candidates.length === 0) {
    console.log('No eligible articles found (all archived or already in a digest)');
    process.exit(0);
  }

  console.log(`Found ${candidates.length} eligible articles:`);
  for (const c of candidates) {
    const tag = c.is_serendipity ? ' [serendipity]' : '';
    console.log(`  ${Number(c.relevance_score).toFixed(2)} - ${c.title}${tag}`);
  }

  // Create digest
  const provider = 'synthetic'; // doesn't affect anything, just a label
  const { rows: digestRows } = await sql`
    INSERT INTO digests (user_id, article_count, provider)
    VALUES (${user.id}, ${candidates.length}, ${provider})
    RETURNING id, generated_at
  `;
  const digest = digestRows[0];

  // Assign articles to digest
  const articleIds = candidates.map(c => c.article_id);
  for (const articleId of articleIds) {
    await sql`
      UPDATE user_articles SET digest_id = ${digest.id}
      WHERE user_id = ${user.id} AND article_id = ${articleId}
    `;
  }

  console.log(`\nDigest created: ${digest.id}`);
  console.log(`  Articles: ${candidates.length}`);
  console.log(`  Generated at: ${digest.generated_at}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
