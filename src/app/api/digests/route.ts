import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getRecentDigests } from '@/lib/db/digests';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const digests = await getRecentDigests(userId);
    return NextResponse.json(digests);
  } catch (error) {
    console.error('Digests error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
