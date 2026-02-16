/**
 * Tests the scoring prompt against the synthetic API to debug token usage.
 * Fetches real articles and interests, builds the exact prompt, and sends it.
 *
 * Usage:
 *   npx tsx scripts/test-scoring.ts
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import OpenAI from 'openai';
import { sql } from '@vercel/postgres';
import { config } from '@/lib/config';

async function main() {
  // Get admin
  const { rows: users } = await sql`
    SELECT id FROM users WHERE is_admin = TRUE LIMIT 1
  `;
  const userId = users[0].id;

  // Get interests
  const { rows: interests } = await sql`
    SELECT category, description, weight FROM interests WHERE user_id = ${userId} AND active = TRUE
  `;

  // Get a few recent articles to build a realistic prompt
  const { rows: articles } = await sql`
    SELECT a.id, a.title, a.url
    FROM articles a
    ORDER BY a.ingested_at DESC
    LIMIT 5
  `;

  const interestNames = interests.map((i: Record<string, unknown>) => i.category);
  const interestList = interests
    .map((i: Record<string, unknown>) => `- ${i.category} (weight: ${i.weight}): ${i.description || 'No description'}`)
    .join('\n');
  const articleList = articles
    .map((a: Record<string, unknown>) => `ID: ${a.id}\nTitle: ${a.title}\nURL: ${a.url}`)
    .join('\n---\n');

  const prompt = `You are a content curator for a daily digest app. Score articles based on the user's interest profile.

## User's Explicit Interests
${interestList}

## User's Learned Preferences
No learned preferences yet.

## Recent Feedback Patterns
No recent feedback data.

## Instructions

For each article, provide:
1. **relevance_score** (0.0 to 1.0): How relevant to the user
2. **relevance_reason**: MUST be one of these exact formats:
   - "Matches: [Interest Name]" — where [Interest Name] is one of: ${interestNames.join(', ')}
   - "Serendipity" — ONLY for true serendipity items (see below)
3. **is_serendipity** (boolean): ALMOST ALWAYS false. See strict criteria below.

### Scoring Guidelines
- 0.8-1.0: Directly matches primary interests, high-quality content
- 0.6-0.8: Good match, relevant and worth reading
- 0.4-0.6: Weak match or serendipity candidate
- 0.0-0.4: Not relevant enough to include

## Articles to Score
${articleList}

Respond ONLY with a JSON array (no markdown code fences):
[
  {
    "article_id": "...",
    "relevance_score": 0.85,
    "relevance_reason": "Matches: AI / LLMs / Local Models",
    "is_serendipity": false
  }
]`;

  console.log(`Prompt: ${prompt.length} chars`);
  console.log(`Articles: ${articles.length}`);
  console.log(`Interests: ${interests.length}\n`);

  const client = new OpenAI({
    apiKey: config.syntheticApiKey,
    baseURL: 'https://api.synthetic.new/openai/v1',
  });

  // Test with different max_tokens
  for (const maxTokens of [4096, 8192, 16384]) {
    console.log(`--- max_tokens: ${maxTokens} ---`);
    try {
      const response = await client.chat.completions.create({
        model: config.syntheticModel,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON when asked. No markdown fences, no explanations — just the JSON.' },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const reasoning = (response.choices[0]?.message as Record<string, unknown>)?.reasoning_content as string || '';

      console.log(`finish_reason: ${response.choices[0]?.finish_reason}`);
      console.log(`usage: prompt=${response.usage?.prompt_tokens}, completion=${response.usage?.completion_tokens}, total=${response.usage?.total_tokens}`);
      console.log(`reasoning length: ${reasoning.length} chars`);
      console.log(`content length: ${content.length} chars`);
      if (content) {
        console.log(`content preview: ${content.slice(0, 200)}`);
      }
      console.log();

      // If we got content, no need to test higher
      if (content) break;
    } catch (err) {
      console.log(`Error: ${(err as Error).message}\n`);
    }
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
