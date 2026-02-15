import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getSourcesByUserId, createSource } from '@/lib/db/sources';
import { createArticle } from '@/lib/db/articles';
import { processManualUrl } from '@/lib/ingestion/manual';
import { seedDatabase } from '@/lib/db/seed';

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 });
    }

    // Find or create manual_url source
    const sources = await getSourcesByUserId(user.id);
    let manualSource = sources.find(s => s.type === 'manual_url');
    if (!manualSource) {
      manualSource = await createSource(user.id, 'Manual URLs', 'manual_url', {});
    }

    const rawArticle = await processManualUrl(manualSource.id, url);
    if (!rawArticle) {
      return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 400 });
    }

    const article = await createArticle(rawArticle);
    return NextResponse.json({ success: true, article });
  } catch (error) {
    console.error('Manual URL error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
