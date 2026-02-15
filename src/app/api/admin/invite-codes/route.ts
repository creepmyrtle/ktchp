import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { createInviteCode, getAllInviteCodes } from '@/lib/db/invite-codes';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const codes = await getAllInviteCodes();
    return NextResponse.json(codes);
  } catch (error) {
    console.error('Admin invite codes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const code = await createInviteCode(userId);
    return NextResponse.json(code, { status: 201 });
  } catch (error) {
    console.error('Create invite code error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
