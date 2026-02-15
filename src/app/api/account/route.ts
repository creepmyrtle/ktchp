import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSessionFromCookies } from '@/lib/auth';
import { getUserById, updateUser } from '@/lib/db/users';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { password_hash, ...safeUser } = user;
    return NextResponse.json(safeUser);
  } catch (error) {
    console.error('Account error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { display_name, current_password, new_password } = await request.json();

    const updates: Record<string, unknown> = {};

    if (display_name !== undefined) {
      updates.display_name = display_name;
    }

    if (new_password) {
      if (!current_password) {
        return NextResponse.json({ error: 'Current password required' }, { status: 400 });
      }

      const user = await getUserById(userId);
      if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }

      if (new_password.length < 6) {
        return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
      }

      updates.password_hash = bcrypt.hashSync(new_password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const user = await updateUser(userId, updates);
    if (!user) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

    const { password_hash, ...safeUser } = user;
    return NextResponse.json(safeUser);
  } catch (error) {
    console.error('Account update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
