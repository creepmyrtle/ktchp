import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getInterestsByUserId, createInterest } from '@/lib/db/interests';
import { generateEmbedding, storeEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const interests = await getInterestsByUserId(userId);
    return NextResponse.json(interests);
  } catch (error) {
    console.error('Interests error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { category, description, weight } = await request.json();
    if (!category) {
      return NextResponse.json({ error: 'Category required' }, { status: 400 });
    }

    const interest = await createInterest(userId, category, description || null, weight || 1.0);

    // Generate embedding async (fire and forget — not needed until next ingestion)
    const embeddingText = buildInterestEmbeddingText(category, description || null);
    generateEmbedding(embeddingText)
      .then(emb => storeEmbedding('interest', interest.id, embeddingText, emb))
      .catch(err => console.error('Interest embedding generation failed:', err));

    return NextResponse.json(interest, { status: 201 });
  } catch (error) {
    console.error('Create interest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
