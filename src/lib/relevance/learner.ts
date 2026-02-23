import { llmComplete } from '../llm';
import { getFeedbackCount, getRecentFeedbackWithArticles } from '../db/feedback';
import { getPreferencesByUserId, createPreference, clearPreferences } from '../db/preferences';
import { getSetting, setSetting } from '../db/settings';

const FEEDBACK_WINDOW = 500;
const MIN_FEEDBACK = 10;
const RELEARN_INTERVAL = 50;

interface PreferenceResult {
  preference_text: string;
  confidence: number;
  derived_from_count: number;
}

export async function shouldRunLearning(userId: string): Promise<boolean> {
  const feedbackCount = await getFeedbackCount(userId);
  if (feedbackCount < MIN_FEEDBACK) return false;

  const lastCountStr = await getSetting(userId, 'last_learning_feedback_count');
  const lastCount = lastCountStr ? parseInt(lastCountStr, 10) : 0;

  return feedbackCount - lastCount >= RELEARN_INTERVAL;
}

export async function runPreferenceLearning(userId: string): Promise<boolean> {
  const feedbackCount = await getFeedbackCount(userId);
  if (feedbackCount < MIN_FEEDBACK) return false;

  const recentFeedback = await getRecentFeedbackWithArticles(userId, FEEDBACK_WINDOW);
  if (recentFeedback.length < MIN_FEEDBACK) return false;

  const existingPrefs = await getPreferencesByUserId(userId);

  // Only sentiment + read actions matter for learning
  const LEARNING_ACTIONS = new Set(['liked', 'skipped', 'read']);
  const relevant = (recentFeedback as Record<string, unknown>[])
    .filter(f => LEARNING_ACTIONS.has(f.action as string));

  // Deduplicate: only keep one entry per article (the most recent action)
  const seen = new Set<string>();
  const dedupedFeedback = relevant.filter(f => {
    const key = f.title as string;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Prioritize strong signals (liked/read) over weak (skipped), cap at 100
  const MAX_ARTICLES = 100;
  const strong = dedupedFeedback.filter(f => f.action !== 'skipped');
  const weak = dedupedFeedback.filter(f => f.action === 'skipped');
  const capped = [...strong, ...weak].slice(0, MAX_ARTICLES);

  const feedbackList = capped
    .map(f =>
      `${f.action} | ${(f.title as string).slice(0, 80)} | ${f.source_name} | ${f.relevance_reason || 'unknown'}`
    )
    .join('\n');

  const existingPrefList = existingPrefs.length > 0
    ? existingPrefs.map(p => `- ${p.preference_text} (confidence: ${p.confidence})`).join('\n')
    : 'None yet.';

  const prompt = `Analyze this user's content feedback to identify patterns and preferences.

## Recent Feedback (${capped.length} articles)
${feedbackList}

## Current Learned Preferences
${existingPrefList}

## Instructions
Based on the feedback patterns, generate or update preference statements. Each should be:
- A clear, natural language statement about what the user likes/dislikes
- Include a confidence score (0.0-1.0) based on how consistent the signal is

Return ONLY a JSON array (no markdown code fences):
[
  {
    "preference_text": "User strongly prefers technical deep-dives over news summaries",
    "confidence": 0.8,
    "derived_from_count": 15
  }
]`;

  try {
    const response = await llmComplete(prompt, 4096);
    if (!response) return false;

    let parsed: PreferenceResult[];
    try {
      parsed = JSON.parse(response.text);
    } catch {
      // Try extracting from markdown code fences
      const fenceMatch = response.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        parsed = JSON.parse(fenceMatch[1]);
      } else {
        // Try extracting a JSON array from anywhere in the response
        const arrayMatch = response.text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          parsed = JSON.parse(arrayMatch[0]);
        } else {
          console.error('Raw LLM response:', response.text.slice(0, 500));
          throw new Error('Could not parse JSON from response');
        }
      }
    }

    await clearPreferences(userId);
    for (const pref of parsed) {
      await createPreference(userId, pref.preference_text, pref.derived_from_count, pref.confidence);
    }

    // Record the feedback count so we know when to re-learn
    await setSetting(userId, 'last_learning_feedback_count', String(feedbackCount));

    return true;
  } catch (error) {
    console.error('Preference learning error:', error);
    return false;
  }
}
