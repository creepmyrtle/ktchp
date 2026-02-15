import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireCronOrAuth } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { seedDatabase } from '@/lib/db/seed';
import { runIngestion } from '@/lib/ingestion';
import { runRelevanceEngine } from '@/lib/relevance';
import { getActiveProvider } from '@/lib/llm';

export const maxDuration = 300; // 5 minute timeout

export async function POST(request: Request) {
  try {
    // Check auth: either CRON_SECRET or session token
    let userId = await requireCronOrAuth(request);
    if (!userId) {
      userId = await getSessionFromCookies();
    }
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure DB is seeded
    await seedDatabase();

    const user = await getDefaultUser();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 500 });
    }

    // Get current provider for tagging
    const provider = await getActiveProvider();

    // Run ingestion
    const ingestionResult = await runIngestion(user.id, provider);

    // Run relevance engine if new articles were ingested
    let digestResult = null;
    if (ingestionResult.newArticles > 0) {
      digestResult = await runRelevanceEngine(user.id, provider);
    }

    return NextResponse.json({
      success: true,
      provider,
      ingestion: ingestionResult,
      digest: digestResult,
    });
  } catch (error) {
    console.error('Ingestion error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
