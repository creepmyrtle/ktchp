import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getSetting, setSetting } from '@/lib/db/settings';
import { seedDatabase } from '@/lib/db/seed';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const direction = (await getSetting(user.id, 'swipe_archive_direction')) || 'right';
    return NextResponse.json({ direction });
  } catch (error) {
    console.error('Get swipe setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const { direction } = await request.json();
    if (direction !== 'right' && direction !== 'left') {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
    }

    await setSetting(user.id, 'swipe_archive_direction', direction);
    return NextResponse.json({ success: true, direction });
  } catch (error) {
    console.error('Set swipe setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
