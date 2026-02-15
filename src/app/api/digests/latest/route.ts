import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getLatestDigest } from '@/lib/db/digests';
import { getUserArticlesByDigestId } from '@/lib/db/user-articles';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const digest = await getLatestDigest(userId);
    if (!digest) {
      return NextResponse.json({ digest: null, articles: [] });
    }

    const articles = await getUserArticlesByDigestId(userId, digest.id);
    return NextResponse.json({ digest, articles });
  } catch (error) {
    console.error('Latest digest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
