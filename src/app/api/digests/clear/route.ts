import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { clearArticlesByProvider } from '@/lib/db/articles';
import { clearDigestsByProvider } from '@/lib/db/digests';
import { getActiveProvider } from '@/lib/llm';

export async function POST() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const provider = await getActiveProvider();
    await clearArticlesByProvider(provider);
    await clearDigestsByProvider(provider);

    return NextResponse.json({ success: true, provider });
  } catch (error) {
    console.error('Clear digest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
