import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getIngestionLogById } from '@/lib/db/ingestion-logs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const log = await getIngestionLogById(id);
    if (!log) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(log);
  } catch (error) {
    console.error('Ingestion log detail error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
