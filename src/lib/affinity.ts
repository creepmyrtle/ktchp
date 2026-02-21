import { llmComplete } from './llm';
import { getActiveInterestsByUserId } from './db/interests';
import { getRecentFeedbackWithArticles } from './db/feedback';
import { getDismissedCategories, createSuggestion, getPendingSuggestions } from './db/suggestions';
import type { IngestionLogger } from './ingestion/logger';

interface AffinitySuggestion {
  category: string;
  description: string;
  related_interests: string[];
  reasoning: string;
  confidence: number;
}

export async function runAffinityAnalysis(userId: string, logger?: IngestionLogger): Promise<number> {
  const interests = await getActiveInterestsByUserId(userId);
  const recentFeedback = await getRecentFeedbackWithArticles(userId, 100);

  // Only analyze if there's enough feedback data
  const likedArticles = recentFeedback.filter(f => f.action === 'liked');
  const bookmarkedArticles = recentFeedback.filter(f => f.action === 'bookmark');

  if (likedArticles.length < 5) {
    logger?.log('affinity', `Skipping affinity analysis: only ${likedArticles.length} liked articles (need 5+)`);
    return 0;
  }

  // Skip if there are already pending suggestions
  const pending = await getPendingSuggestions(userId);
  if (pending.length > 0) {
    logger?.log('affinity', `Skipping affinity analysis: ${pending.length} pending suggestion(s) exist`);
    return 0;
  }

  const dismissedCategories = await getDismissedCategories(userId);

  const interestList = interests
    .map(i => `- ${i.category}: ${i.description || 'No description'}`)
    .join('\n');

  const likedList = likedArticles
    .slice(0, 50)
    .map(f => `- "${f.title}" (${f.relevance_reason || 'no reason'}) [${f.source_name}]`)
    .join('\n');

  const bookmarkedList = bookmarkedArticles
    .slice(0, 20)
    .map(f => `- "${f.title}" [${f.source_name}]`)
    .join('\n');

  const dismissedNote = dismissedCategories.length > 0
    ? `\n\n## Previously Dismissed (DO NOT re-suggest)\n${dismissedCategories.map(c => `- ${c}`).join('\n')}`
    : '';

  const prompt = `You are analyzing a user's content engagement patterns to discover latent interests — topics they consistently engage with but haven't explicitly added to their interest profile.

## User's Current Interests
${interestList}

## Recently Liked Articles (last 30 days)
${likedList || 'No liked articles yet.'}

## Recently Bookmarked Articles
${bookmarkedList || 'No bookmarked articles yet.'}
${dismissedNote}

## Instructions

Identify 2-4 topic areas that:
1. Are NOT already covered by the user's stated interests
2. Appear frequently in the user's liked/bookmarked articles
3. Have a clear, logical connection to one or more existing interests
4. Would meaningfully improve article recommendations if added

For each suggested topic, provide:
- **category**: A concise name (2-5 words) suitable as an interest category
- **description**: A 1-2 sentence description of what this topic covers
- **related_interests**: Which of the user's existing interests this is connected to
- **reasoning**: Why you believe the user would be interested (reference specific article patterns)
- **confidence**: 0.0-1.0 how confident you are in this suggestion

Only suggest topics where you see clear evidence in the engagement data. Do not pad the list — if you only see 1-2 genuine suggestions, return only those. If you see no clear suggestions, return an empty array.

Respond ONLY with a JSON array (no markdown code fences):
[
  {
    "category": "Urban Planning & Zoning",
    "description": "City planning, zoning reform, transit-oriented development, land use policy",
    "related_interests": ["Civic Tech / GovTech", "Dallas / DFW Local News"],
    "reasoning": "User liked 6 articles about Dallas zoning changes and 3 about transit development in the last month",
    "confidence": 0.78
  }
]`;

  try {
    const response = await llmComplete(prompt, 2048);
    if (!response?.text) {
      logger?.warn('affinity', 'LLM returned empty response');
      return 0;
    }

    let suggestions: AffinitySuggestion[];
    try {
      const text = response.text.trim();
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      suggestions = arrayMatch ? JSON.parse(arrayMatch[0]) : JSON.parse(text);
    } catch {
      logger?.warn('affinity', `Failed to parse affinity response: ${response.text.slice(0, 200)}`);
      return 0;
    }

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      logger?.log('affinity', 'No suggestions generated');
      return 0;
    }

    // Filter out dismissed categories and existing interests
    const existingCategories = new Set(interests.map(i => i.category.toLowerCase()));
    const dismissedSet = new Set(dismissedCategories.map(c => c.toLowerCase()));

    const valid = suggestions.filter(s =>
      s.category &&
      s.confidence >= 0.3 &&
      !existingCategories.has(s.category.toLowerCase()) &&
      !dismissedSet.has(s.category.toLowerCase())
    );

    for (const s of valid) {
      await createSuggestion(
        userId,
        s.category,
        s.description || null,
        s.related_interests || [],
        s.reasoning || null,
        s.confidence
      );
    }

    logger?.log('affinity', `Created ${valid.length} interest suggestion(s)`);
    return valid.length;
  } catch (error) {
    logger?.error('affinity', `Affinity analysis failed: ${error}`);
    return 0;
  }
}
