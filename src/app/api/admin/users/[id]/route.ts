import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { updateUser, getUserById, deleteUser } from '@/lib/db/users';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { id } = await params;
    const { is_active, is_admin, display_name } = await request.json();

    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Prevent self-deactivation
    if (id === userId && is_active === false) {
      return NextResponse.json({ error: 'Cannot deactivate yourself' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (is_active !== undefined) updates.is_active = is_active;
    if (is_admin !== undefined) updates.is_admin = is_admin;
    if (display_name !== undefined) updates.display_name = display_name;

    const user = await updateUser(id, updates);
    if (!user) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

    const { password_hash, ...safeUser } = user;
    return NextResponse.json(safeUser);
  } catch (error) {
    console.error('Admin user update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { id } = await params;

    if (id === userId) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const deleted = await deleteUser(id);
    if (!deleted) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin user delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
