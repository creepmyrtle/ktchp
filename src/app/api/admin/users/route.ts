import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { getAllUsers } from '@/lib/db/users';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const users = await getAllUsers();
    // Strip password hashes
    const safeUsers = users.map(({ password_hash, ...rest }) => rest);
    return NextResponse.json(safeUsers);
  } catch (error) {
    console.error('Admin users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
