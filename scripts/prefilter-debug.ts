/**
 * Dry-run prefilter analysis for a specific user.
 * Shows exactly which articles would be removed and why.
 * Does NOT modify the database.
 *
 * Usage:
 *   npx tsx scripts/prefilter-debug.ts                — debug admin user
 *   npx tsx scripts/prefilter-debug.ts <username>     — debug specific user
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { sql } from '@vercel/postgres';
import { getEnabledSourcesForUser } from '@/lib/db/sources';
import { getUnscoredArticlesForUser } from '@/lib/db/user-articles';
import { prefilterArticles } from '@/lib/relevance/prefilter';
import type { Article } from '@/types';

async function main() {
  const targetUsername = process.argv[2] || null;

  // Find user
  let user;
  if (targetUsername) {
    const { rows } = await sql`SELECT id, username, display_name, created_at FROM users WHERE username = ${targetUsername}`;
    user = rows[0];
    if (!user) {
      console.error(`User "${targetUsername}" not found`);
      process.exit(1);
    }
  } else {
    const { rows } = await sql`SELECT id, username, display_name, created_at FROM users WHERE is_admin = TRUE LIMIT 1`;
    user = rows[0];
    if (!user) {
      console.error('No admin user found');
      process.exit(1);
    }
  }

  const accountAge = Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24));
  console.log(`User: ${user.display_name || user.username} (@${user.username}), account age: ${accountAge}d\n`);

  // Get unscored articles
  const sources = await getEnabledSourcesForUser(user.id);
  const sourceIds = sources.map(s => s.id);
  const unscored = await getUnscoredArticlesForUser(user.id, sourceIds);
  console.log(`Unscored articles: ${unscored.length}\n`);

  if (unscored.length === 0) {
    console.log('No unscored articles to analyze.');
    process.exit(0);
  }

  // Cast to Article shape for prefilter
  const asArticles = unscored.map(a => ({
    ...a,
    external_id: null,
    raw_content: a.raw_content,
    summary: null,
    provider: '',
    ingested_at: '',
  })) as Article[];

  // Run prefilter
  const userCreatedAt = user.created_at ? new Date(user.created_at) : undefined;
  const { kept, removed } = prefilterArticles(asArticles, { userCreatedAt });

  // Summary by reason
  const reasonCounts: Record<string, number> = {};
  for (const r of removed) {
    reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
  }

  console.log(`─── SUMMARY ───`);
  console.log(`  Kept: ${kept.length}`);
  console.log(`  Removed: ${removed.length}`);
  for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${count}`);
  }

  // Details per reason
  for (const reason of Object.keys(reasonCounts).sort()) {
    const items = removed.filter(r => r.reason === reason);
    console.log(`\n─── ${reason.toUpperCase()} (${items.length}) ───`);
    for (const item of items.slice(0, 25)) {
      const extra = reason === 'stale'
        ? (() => {
            const article = unscored.find(a => a.url === item.url);
            if (article?.published_at) {
              const days = Math.floor((Date.now() - new Date(article.published_at).getTime()) / (1000 * 60 * 60 * 24));
              return ` (${days}d old)`;
            }
            return '';
          })()
        : '';
      console.log(`  ${item.title.slice(0, 70)}${extra}`);
      console.log(`    ${item.url}`);
    }
    if (items.length > 25) {
      console.log(`  ... and ${items.length - 25} more`);
    }
  }

  // Show kept articles
  console.log(`\n─── KEPT (${kept.length}) ───`);
  for (const a of kept) {
    const age = a.published_at
      ? `${Math.floor((Date.now() - new Date(a.published_at).getTime()) / (1000 * 60 * 60 * 24))}d old`
      : 'no date';
    console.log(`  ${a.title.slice(0, 70)} (${age})`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
