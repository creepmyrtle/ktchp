/**
 * Deletes the N most recent digests, unassigning their articles
 * so they can be re-scored and re-digested.
 *
 * Usage:
 *   npx tsx scripts/delete-digests.ts              — delete 1 latest digest for all active users
 *   npx tsx scripts/delete-digests.ts 3             — delete 3 latest digests for all active users
 *   npx tsx scripts/delete-digests.ts 1 admin       — delete 1 latest digest for user "admin"
 *   npx tsx scripts/delete-digests.ts 2 all         — same as no username (all active users)
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { sql } from '@vercel/postgres';

async function main() {
  const count = parseInt(process.argv[2] || '1', 10);
  const targetUsername = process.argv[3] || null; // optional: specific username, or 'all'

  // Get target users
  let users;
  if (targetUsername && targetUsername !== 'all') {
    const { rows } = await sql`
      SELECT id, username, display_name FROM users WHERE username = ${targetUsername}
    `;
    users = rows;
    if (users.length === 0) {
      console.error(`User "${targetUsername}" not found`);
      process.exit(1);
    }
  } else if (targetUsername === 'all') {
    const { rows } = await sql`
      SELECT id, username, display_name FROM users WHERE is_active = TRUE ORDER BY created_at ASC
    `;
    users = rows;
  } else {
    // Default: all active users
    const { rows } = await sql`
      SELECT id, username, display_name FROM users WHERE is_active = TRUE ORDER BY created_at ASC
    `;
    users = rows;
  }

  if (users.length === 0) {
    console.error('No users found');
    process.exit(1);
  }

  for (const user of users) {
    console.log(`\n${user.display_name || user.username} (@${user.username}):`);

    // Get the most recent digests for this user
    const { rows: digests } = await sql`
      SELECT id, generated_at, article_count
      FROM digests
      WHERE user_id = ${user.id}
      ORDER BY generated_at DESC
      LIMIT ${count}
    `;

    if (digests.length === 0) {
      console.log('  No digests found');
      continue;
    }

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
  }

  console.log('\nDone. Run ingestion to re-score and create new digests.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
