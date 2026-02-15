import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { deletePreference } from '@/lib/db/preferences';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const deleted = await deletePreference(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete preference error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
