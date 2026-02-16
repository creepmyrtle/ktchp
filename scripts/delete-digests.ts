/**
 * Deletes the N most recent digests for the admin user,
 * unassigning their articles so they can be re-scored and re-digested.
 *
 * Usage:
 *   npx tsx scripts/delete-digests.ts [count]   (default: 2)
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { sql } from '@vercel/postgres';

async function main() {
  const count = parseInt(process.argv[2] || '2', 10);

  // Get admin user
  const { rows: users } = await sql`
    SELECT id, username, display_name FROM users WHERE is_admin = TRUE LIMIT 1
  `;
  if (users.length === 0) {
    console.error('No admin user found');
    process.exit(1);
  }
  const user = users[0];
  console.log(`Admin: ${user.display_name || user.username} (${user.id})`);

  // Get the most recent digests
  const { rows: digests } = await sql`
    SELECT id, generated_at, article_count
    FROM digests
    WHERE user_id = ${user.id}
    ORDER BY generated_at DESC
    LIMIT ${count}
  `;

  if (digests.length === 0) {
    console.log('No digests found');
    process.exit(0);
  }

  console.log(`\nDeleting ${digests.length} digest(s):\n`);

  for (const digest of digests) {
    console.log(`  ${digest.id} — ${new Date(digest.generated_at).toLocaleString()} (${digest.article_count} articles)`);

    // Clear digest_id and reset fallback scores so articles get re-scored
    const { rowCount: cleared } = await sql`
      UPDATE user_articles
      SET digest_id = NULL,
          relevance_score = NULL,
          relevance_reason = NULL,
          is_serendipity = FALSE,
          scored_at = NULL
      WHERE user_id = ${user.id} AND digest_id = ${digest.id} AND is_archived = FALSE
    `;
    console.log(`    Unassigned ${cleared} non-archived article(s) for re-scoring`);

    // For archived articles, just clear the digest_id (keep their scores)
    const { rowCount: archivedCleared } = await sql`
      UPDATE user_articles
      SET digest_id = NULL
      WHERE user_id = ${user.id} AND digest_id = ${digest.id} AND is_archived = TRUE
    `;
    if (archivedCleared && archivedCleared > 0) {
      console.log(`    Unassigned ${archivedCleared} archived article(s) (scores preserved)`);
    }

    // Delete the digest
    await sql`DELETE FROM digests WHERE id = ${digest.id}`;
    console.log(`    Digest deleted`);
  }

  console.log('\nDone. Run ingestion to re-score and create new digests.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
