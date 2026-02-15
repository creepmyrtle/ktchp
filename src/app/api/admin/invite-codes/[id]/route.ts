import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { deleteInviteCode } from '@/lib/db/invite-codes';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { id } = await params;
    const deleted = await deleteInviteCode(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete invite code error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
