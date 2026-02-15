import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getIngestionLogs, getAllIngestionLogs } from '@/lib/db/ingestion-logs';
import { getUserById } from '@/lib/db/users';

export async function GET(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    const user = await getUserById(userId);
    const logs = user?.is_admin
      ? await getAllIngestionLogs(limit)
      : await getIngestionLogs(userId, limit);

    return NextResponse.json(logs);
  } catch (error) {
    console.error('Ingestion logs error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
