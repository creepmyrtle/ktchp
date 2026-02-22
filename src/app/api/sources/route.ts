import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSourcesForUser, createSource } from '@/lib/db/sources';
import type { Source } from '@/types';

type HealthStatus = 'active' | 'slow' | 'stale' | 'error' | 'new';

function computeHealthStatus(source: Source): HealthStatus {
  const now = Date.now();
  const DAY = 86_400_000;

  // Never fetched
  if (!source.last_fetched_at) {
    const createdAt = new Date(source.created_at).getTime();
    return (now - createdAt) < DAY ? 'new' : 'stale';
  }

  // Has a fetch error
  if (source.last_fetch_error) {
    return 'error';
  }

  // Check recency of new articles
  if (source.last_new_article_at) {
    const lastNew = new Date(source.last_new_article_at).getTime();
    const daysSinceNew = (now - lastNew) / DAY;
    if (daysSinceNew <= 3) return 'active';
    if (daysSinceNew <= 14) return 'slow';
    return 'stale';
  }

  // last_new_article_at not yet tracked, fall back to article count
  const count = source.articles_14d ?? 0;
  if (count >= 14) return 'active';
  if (count > 0) return 'slow';

  return 'stale';
}

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sources = await getSourcesForUser(userId);
    const enriched = sources.map(source => ({
      ...source,
      health_status: computeHealthStatus(source),
    }));
    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Sources error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, type, config } = await request.json();
    if (!name || !type || !config) {
      return NextResponse.json({ error: 'Name, type, and config required' }, { status: 400 });
    }

    const source = await createSource(userId, name, type, config);
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    console.error('Create source error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
