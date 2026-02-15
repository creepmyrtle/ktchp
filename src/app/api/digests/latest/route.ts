import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getLatestDigest } from '@/lib/db/digests';
import { getArticlesByDigestId } from '@/lib/db/articles';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getDefaultUser();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 500 });
    }

    const digest = await getLatestDigest(user.id);
    if (!digest) {
      return NextResponse.json({ digest: null, articles: [] });
    }

    const articles = await getArticlesByDigestId(digest.id);
    return NextResponse.json({ digest, articles });
  } catch (error) {
    console.error('Latest digest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
