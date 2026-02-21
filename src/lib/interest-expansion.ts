import { llmComplete } from './llm';

/**
 * Uses the LLM to expand a short interest description into a rich, 150-200 word
 * paragraph that captures the full semantic range — subtopics, related terminology,
 * adjacent concepts, example entities, and typical article subjects.
 * This expanded text produces better embeddings for semantic matching.
 */
export async function expandInterestDescription(
  category: string,
  description: string | null
): Promise<string | null> {
  const prompt = `You are helping build a content recommendation system. Given this interest category and description, write a single dense paragraph (150-200 words) that captures the FULL semantic range of topics this person would want to read about.

Include: subtopics, related terminology, adjacent concepts, key entities (companies, organizations, technologies), typical article subjects, and the kinds of headlines someone with this interest would click on.

Do NOT use bullet points or lists. Write it as a flowing paragraph optimized for semantic similarity matching.

Interest: "${category}"
Description: "${description || 'No additional description provided.'}"

Expanded description:`;

  const response = await llmComplete(prompt, 1024);
  if (!response?.text) return null;

  const text = response.text.trim();
  // Remove any quotes the LLM might wrap the response in
  return text.replace(/^["']|["']$/g, '').trim();
}
