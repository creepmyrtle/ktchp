import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getExclusionsByUserId, createExclusion, updateExclusion } from '@/lib/db/exclusions';
import { generateEmbedding, storeEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';
import { expandInterestDescription } from '@/lib/interest-expansion';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const exclusions = await getExclusionsByUserId(userId);
    return NextResponse.json(exclusions);
  } catch (error) {
    console.error('Exclusions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { category, description } = await request.json();
    if (!category) {
      return NextResponse.json({ error: 'Category required' }, { status: 400 });
    }

    const exclusion = await createExclusion(userId, category, description || null);

    // Expand + generate embedding async
    (async () => {
      try {
        const expanded = await expandInterestDescription(category, description || null);
        if (expanded) {
          await updateExclusion(exclusion.id, { expanded_description: expanded });
        }
        const embeddingText = buildInterestEmbeddingText(category, description || null, expanded);
        const emb = await generateEmbedding(embeddingText);
        await storeEmbedding('exclusion', exclusion.id, embeddingText, emb);
      } catch (err) {
        console.error('Exclusion expansion/embedding failed:', err);
      }
    })();

    return NextResponse.json(exclusion, { status: 201 });
  } catch (error) {
    console.error('Create exclusion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
