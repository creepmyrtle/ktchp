/**
 * Force-runs preference learning for the admin user,
 * ignoring the 50-event gate.
 *
 * Usage:
 *   npx tsx scripts/learn-prefs.ts
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { sql } from '@vercel/postgres';
import { runPreferenceLearning } from '@/lib/relevance/learner';
import { getFeedbackCount } from '@/lib/db/feedback';
import { getPreferencesByUserId } from '@/lib/db/preferences';
import { getActiveProvider } from '@/lib/llm';
import { config } from '@/lib/config';

async function main() {
  const { rows: users } = await sql`
    SELECT id, username, display_name FROM users WHERE is_admin = TRUE LIMIT 1
  `;
  if (users.length === 0) {
    console.error('No admin user found');
    process.exit(1);
  }
  const user = users[0];
  console.log(`Admin user: ${user.display_name || user.username} (${user.id})`);

  const count = await getFeedbackCount(user.id);
  console.log(`Feedback events: ${count}`);

  const provider = await getActiveProvider();
  console.log(`Active provider: ${provider}`);
  console.log(`Synthetic API key set (config): ${!!config.syntheticApiKey}`);
  console.log(`Synthetic API key set (env): ${!!process.env.SYNTHETIC_API_KEY}`);

  if (count < 10) {
    console.log('Not enough feedback yet (need at least 10)');
    process.exit(0);
  }

  // Quick check: how big is the prompt?
  const { getRecentFeedbackWithArticles } = await import('@/lib/db/feedback');
  const feedback = await getRecentFeedbackWithArticles(user.id, 200);
  const promptText = feedback.map((f: Record<string, unknown>) =>
    `Action: ${f.action} | Title: ${f.title} | Source: ${f.source_name} | Category: ${f.relevance_reason || 'unknown'}`
  ).join('\n');
  console.log(`Feedback rows: ${feedback.length}, prompt chars: ~${promptText.length}`);

  console.log('Running preference learning...\n');
  const result = await runPreferenceLearning(user.id);

  if (!result) {
    console.log('Learning returned false — check LLM provider config');
    process.exit(1);
  }

  const prefs = await getPreferencesByUserId(user.id);
  console.log(`Generated ${prefs.length} preferences:\n`);
  for (const p of prefs) {
    console.log(`  [${p.confidence.toFixed(1)}] ${p.preference_text} (from ${p.derived_from_count} signals)`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
