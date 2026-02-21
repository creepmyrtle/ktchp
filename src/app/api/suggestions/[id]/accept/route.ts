import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSuggestionById, acceptSuggestion } from '@/lib/db/suggestions';
import { createInterest, updateInterest } from '@/lib/db/interests';
import { generateEmbedding, storeEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';
import { expandInterestDescription } from '@/lib/interest-expansion';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const suggestion = await getSuggestionById(id);
    if (!suggestion || suggestion.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (suggestion.status !== 'pending') {
      return NextResponse.json({ error: 'Suggestion already resolved' }, { status: 400 });
    }

    // Create interest from suggestion
    const interest = await createInterest(userId, suggestion.category, suggestion.description, 0.8);

    // Mark suggestion as accepted
    await acceptSuggestion(id);

    // Expand + embed async
    (async () => {
      try {
        const expanded = await expandInterestDescription(suggestion.category, suggestion.description);
        if (expanded) {
          await updateInterest(interest.id, { expanded_description: expanded });
        }
        const embeddingText = buildInterestEmbeddingText(suggestion.category, suggestion.description, expanded);
        const emb = await generateEmbedding(embeddingText);
        await storeEmbedding('interest', interest.id, embeddingText, emb);
      } catch (err) {
        console.error('Suggestion accept expansion/embedding failed:', err);
      }
    })();

    return NextResponse.json({ success: true, interest });
  } catch (error) {
    console.error('Accept suggestion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
