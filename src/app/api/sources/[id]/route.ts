import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSourceById, updateSource, deleteSource, setUserSourceSetting } from '@/lib/db/sources';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getSourceById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updates = await request.json();

    // Default sources: users can only toggle via user_source_settings
    if (existing.is_default && existing.user_id !== userId) {
      if (updates.enabled !== undefined) {
        await setUserSourceSetting(userId, id, updates.enabled);
        return NextResponse.json({ ...existing, user_enabled: updates.enabled });
      }
      return NextResponse.json({ error: 'Cannot modify default source' }, { status: 403 });
    }

    // Own source: full update
    if (existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const source = await updateSource(id, updates);
    return NextResponse.json(source);
  } catch (error) {
    console.error('Update source error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getSourceById(id);
    if (!existing || existing.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const deleted = await deleteSource(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete source error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
