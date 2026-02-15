import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDigestById } from '@/lib/db/digests';
import { getUserArticlesByDigestId } from '@/lib/db/user-articles';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const digest = await getDigestById(id);
    if (!digest) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Ownership check
    if (digest.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const articles = await getUserArticlesByDigestId(userId, digest.id);
    return NextResponse.json({ digest, articles });
  } catch (error) {
    console.error('Digest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
