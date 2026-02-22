import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getInterestsByUserId, createInterest, updateInterest } from '@/lib/db/interests';
import { generateEmbedding, storeEmbedding, buildInterestEmbeddingText } from '@/lib/embeddings';
import { expandInterestDescription } from '@/lib/interest-expansion';
import { getGlobalSetting } from '@/lib/db/settings';

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

    // Check soft limit
    const existing = await getInterestsByUserId(userId);
    const activeCount = existing.filter(i => i.active).length;
    const maxSetting = await getGlobalSetting('max_interests_per_user');
    const maxInterests = maxSetting ? parseInt(maxSetting, 10) : 20;
    if (activeCount >= maxInterests) {
      return NextResponse.json(
        { error: `Interest limit reached (${maxInterests}). Deactivate or remove an interest to add a new one.` },
        { status: 400 }
      );
    }

    const interest = await createInterest(userId, category, description || null, weight || 1.0);

    // Expand description + generate embedding async (fire and forget)
    (async () => {
      try {
        const expanded = await expandInterestDescription(category, description || null);
        if (expanded) {
          await updateInterest(interest.id, { expanded_description: expanded });
        }
        const embeddingText = buildInterestEmbeddingText(category, description || null, expanded);
        const emb = await generateEmbedding(embeddingText);
        await storeEmbedding('interest', interest.id, embeddingText, emb);
      } catch (err) {
        console.error('Interest expansion/embedding failed:', err);
      }
    })();

    return NextResponse.json(interest, { status: 201 });
  } catch (error) {
    console.error('Create interest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
