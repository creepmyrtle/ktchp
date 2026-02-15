import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDigestById } from '@/lib/db/digests';
import { getDigestCompletionStats } from '@/lib/db/user-articles';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Ownership check
    const digest = await getDigestById(id);
    if (!digest || digest.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const stats = await getDigestCompletionStats(userId, id);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Digest stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
