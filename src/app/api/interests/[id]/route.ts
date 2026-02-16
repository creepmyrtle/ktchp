import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getInterestById, updateInterest, deleteInterest } from '@/lib/db/interests';
import { generateEmbedding, storeEmbedding, deleteEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Ownership check
    const existing = await getInterestById(id);
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updates = await request.json();
    const interest = await updateInterest(id, updates);

    if (!interest) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Re-generate embedding if text changed (category or description)
    if (updates.category !== undefined || updates.description !== undefined) {
      const embeddingText = buildInterestEmbeddingText(interest.category, interest.description);
      generateEmbedding(embeddingText)
        .then(emb => storeEmbedding('interest', id, embeddingText, emb))
        .catch(err => console.error('Interest embedding update failed:', err));
    }

    return NextResponse.json(interest);
  } catch (error) {
    console.error('Update interest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Ownership check
    const existing = await getInterestById(id);
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const deleted = await deleteInterest(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Clean up embedding
    deleteEmbedding('interest', id).catch(err => console.error('Interest embedding delete failed:', err));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete interest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
