import { config } from '../config';
import { llmComplete } from '../llm';
import type { Article, Interest, LearnedPreference, ScoringResult } from '@/types';

function buildScoringPrompt(
  articles: Article[],
  interests: Interest[],
  preferences: LearnedPreference[],
  recentFeedback: string
): string {
  const interestNames = interests.map(i => i.category);

  const interestList = interests
    .map(i => `- ${i.category} (weight: ${i.weight}): ${i.description || 'No description'}`)
    .join('\n');

  const prefList = preferences.length > 0
    ? preferences.map(p => `- ${p.preference_text} (confidence: ${p.confidence})`).join('\n')
    : 'No learned preferences yet.';

  const articleList = articles
    .map(a => `ID: ${a.id}\nTitle: ${a.title}\nURL: ${a.url}\nContent: ${(a.raw_content || '').slice(0, 300)}`)
    .join('\n---\n');

  return `You are a content curator for a daily digest app. Score and summarize articles based on the user's interest profile.

## User's Explicit Interests
${interestList}

## User's Learned Preferences
${prefList}

## Recent Feedback Patterns
${recentFeedback || 'No recent feedback data.'}

## Instructions

For each article, provide:
1. **relevance_score** (0.0 to 1.0): How relevant to the user
2. **summary** (2-3 sentences): Concise, informative summary
3. **relevance_reason**: MUST be one of these exact formats:
   - "Matches: [Interest Name]" — where [Interest Name] is one of: ${interestNames.join(', ')}
   - "Serendipity" — ONLY for true serendipity items (see below)
4. **is_serendipity** (boolean): ALMOST ALWAYS false. See strict criteria below.

### relevance_reason Rules
- If an article matches ANY stated interest, use "Matches: [Best Matching Interest Name]"
- If it matches multiple interests, pick the strongest match
- Even partial or loose matches to a stated interest should use "Matches: ..."
- ONLY use "Serendipity" for articles that genuinely don't match ANY stated interest but are still valuable

### Serendipity — Use Sparingly
is_serendipity should be true for AT MOST 1-2 articles per batch. It means:
- The article does NOT match any of the user's stated interests, not even loosely
- But it's still genuinely valuable — a major world event, a cross-domain insight, etc.
- If you can justify "Matches: [any interest]", it is NOT serendipity

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
    "summary": "...",
    "relevance_reason": "Matches: AI / LLMs / Local Models",
    "is_serendipity": false
  }
]`;
}

function parseJsonResponse(text: string): ScoringResult[] {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1]);
    }
    // Try finding a JSON array anywhere in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    console.error('Unparseable LLM response:', text.slice(0, 500));
    throw new Error('Could not parse JSON from response');
  }
}

export async function scoreArticles(
  articles: Article[],
  interests: Interest[],
  preferences: LearnedPreference[],
  recentFeedback: string = ''
): Promise<ScoringResult[]> {
  const results: ScoringResult[] = [];

  for (let i = 0; i < articles.length; i += config.batchSize) {
    const batch = articles.slice(i, i + config.batchSize);
    const prompt = buildScoringPrompt(batch, interests, preferences, recentFeedback);

    try {
      const response = await llmComplete(prompt, 8192);

      if (!response) {
        // No API available — fallback
        for (const a of batch) {
          results.push({
            article_id: a.id,
            relevance_score: 0.5,
            summary: a.raw_content?.slice(0, 200) || a.title,
            relevance_reason: 'Default score (API unavailable)',
            is_serendipity: false,
          });
        }
        continue;
      }

      const parsed = parseJsonResponse(response.text);
      results.push(...parsed);
    } catch (error) {
      console.error('LLM scoring error:', error);
      for (const a of batch) {
        results.push({
          article_id: a.id,
          relevance_score: 0.5,
          summary: a.raw_content?.slice(0, 200) || a.title,
          relevance_reason: 'Default score (scoring error)',
          is_serendipity: false,
        });
      }
    }
  }

  return results;
}
