import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getIngestionLogs } from '@/lib/db/ingestion-logs';

export async function GET(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getDefaultUser();
    if (!user) return NextResponse.json([], { status: 200 });

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    const logs = await getIngestionLogs(user.id, limit);
    return NextResponse.json(logs);
  } catch (error) {
    console.error('Ingestion logs error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
