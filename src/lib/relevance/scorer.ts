import { config } from '../config';
import { llmComplete } from '../llm';
import type { Article, Interest, LearnedPreference, ScoringResult } from '@/types';
import type { IngestionLogger } from '../ingestion/logger';

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

function salvateTruncatedJson(text: string): { results: ScoringResult[]; method: string } | null {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) return null;

  let json = text.slice(startIdx);

  const lastComplete = json.lastIndexOf('}');
  if (lastComplete === -1) return null;

  json = json.slice(0, lastComplete + 1);
  json = json.replace(/,\s*$/, '');
  json += ']';

  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return { results: parsed, method: 'salvage' };
    }
  } catch {
    // Salvage failed
  }
  return null;
}

function parseJsonResponse(text: string): { results: ScoringResult[]; method: string } {
  // Try direct parse first
  try {
    return { results: JSON.parse(text), method: 'direct' };
  } catch {
    // Try extracting JSON from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return { results: JSON.parse(fenceMatch[1]), method: 'code_fence' };
    }
    // Try finding a JSON array anywhere in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return { results: JSON.parse(arrayMatch[0]), method: 'array_extraction' };
    }
    // Try salvaging complete objects from truncated response
    const salvaged = salvateTruncatedJson(text);
    if (salvaged) return salvaged;

    console.error('Unparseable LLM response:', text.slice(0, 500));
    throw new Error('Could not parse JSON from response');
  }
}

export async function scoreArticles(
  articles: Article[],
  interests: Interest[],
  preferences: LearnedPreference[],
  recentFeedback: string = '',
  logger?: IngestionLogger
): Promise<ScoringResult[]> {
  const results: ScoringResult[] = [];
  const totalBatches = Math.ceil(articles.length / config.batchSize);

  for (let i = 0; i < articles.length; i += config.batchSize) {
    const batchNum = Math.floor(i / config.batchSize) + 1;
    const batch = articles.slice(i, i + config.batchSize);
    const prompt = buildScoringPrompt(batch, interests, preferences, recentFeedback);

    logger?.log('scoring', `Scoring batch ${batchNum}/${totalBatches}: ${batch.length} articles`, {
      batchNumber: batchNum,
      totalBatches,
      articleCount: batch.length,
      articles: batch.map(a => ({ id: a.id, title: a.title })),
    });

    logger?.log('scoring', `Batch ${batchNum} prompt`, {
      prompt,
      promptLength: prompt.length,
    });

    try {
      const llmStart = Date.now();
      const response = await llmComplete(prompt, 16384);
      const llmDurationMs = Date.now() - llmStart;

      if (!response) {
        logger?.warn('scoring', `Batch ${batchNum}: API unavailable, using fallback scores`, {
          llmDurationMs,
        });
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

      logger?.log('scoring', `Batch ${batchNum} raw LLM response`, {
        llmDurationMs,
        responseLength: response.text.length,
        response: response.text,
      });

      const { results: parsed, method } = parseJsonResponse(response.text);
      const wasTruncated = method === 'salvage';

      logger?.log('scoring', `Batch ${batchNum} parsed: ${parsed.length} results via ${method}`, {
        parseMethod: method,
        wasTruncated,
        salvaged: wasTruncated ? parsed.length : undefined,
        expected: batch.length,
        received: parsed.length,
      });

      // Log each article's scoring result
      for (const score of parsed) {
        const article = batch.find(a => a.id === score.article_id);
        logger?.log('scoring', `Scored: "${article?.title || score.article_id}"`, {
          articleId: score.article_id,
          title: article?.title,
          relevanceScore: score.relevance_score,
          relevanceReason: score.relevance_reason,
          isSerendipity: score.is_serendipity,
          summary: score.summary,
        });
      }

      results.push(...parsed);
    } catch (error) {
      console.error('LLM scoring error:', error);
      logger?.error('scoring', `Batch ${batchNum} scoring error`, {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
