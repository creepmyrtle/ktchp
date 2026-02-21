import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getExclusionById, updateExclusion, deleteExclusion } from '@/lib/db/exclusions';
import { generateEmbedding, storeEmbedding, deleteEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';
import { expandInterestDescription } from '@/lib/interest-expansion';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getExclusionById(id);
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updates = await request.json();
    const exclusion = await updateExclusion(id, updates);
    if (!exclusion) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Re-expand + re-embed if text changed
    if (updates.category !== undefined || updates.description !== undefined) {
      (async () => {
        try {
          const expanded = await expandInterestDescription(exclusion.category, exclusion.description);
          if (expanded) {
            await updateExclusion(id, { expanded_description: expanded });
          }
          const embeddingText = buildInterestEmbeddingText(exclusion.category, exclusion.description, expanded);
          const emb = await generateEmbedding(embeddingText);
          await storeEmbedding('exclusion', id, embeddingText, emb);
        } catch (err) {
          console.error('Exclusion expansion/embedding update failed:', err);
        }
      })();
    }

    return NextResponse.json(exclusion);
  } catch (error) {
    console.error('Update exclusion error:', error);
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
    const existing = await getExclusionById(id);
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const deleted = await deleteExclusion(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    deleteEmbedding('exclusion', id).catch(err => console.error('Exclusion embedding delete failed:', err));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete exclusion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
