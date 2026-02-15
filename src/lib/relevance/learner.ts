import { llmComplete } from '../llm';
import { getFeedbackCount, getRecentFeedbackWithArticles } from '../db/feedback';
import { getPreferencesByUserId, createPreference, clearPreferences } from '../db/preferences';
import { getSetting, setSetting } from '../db/settings';

const FEEDBACK_WINDOW = 200;
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

  const feedbackList = (recentFeedback as Record<string, unknown>[])
    .map(f =>
      `Action: ${f.action} | Title: ${f.title} | Source: ${f.source_name} | Category: ${f.relevance_reason || 'unknown'}`
    )
    .join('\n');

  const existingPrefList = existingPrefs.length > 0
    ? existingPrefs.map(p => `- ${p.preference_text} (confidence: ${p.confidence})`).join('\n')
    : 'None yet.';

  const prompt = `Analyze this user's content feedback to identify patterns and preferences.

## Recent Feedback (last ${recentFeedback.length} interactions)
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
    const response = await llmComplete(prompt, 2048);
    if (!response) return false;

    let parsed: PreferenceResult[];
    try {
      parsed = JSON.parse(response.text);
    } catch {
      const match = response.text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        throw new Error('Could not parse JSON from response');
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
