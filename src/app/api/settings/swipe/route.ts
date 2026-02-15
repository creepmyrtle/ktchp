import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/db/settings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const direction = (await getSetting(userId, 'swipe_archive_direction')) || 'right';
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

    const { direction } = await request.json();
    if (direction !== 'right' && direction !== 'left') {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
    }

    await setSetting(userId, 'swipe_archive_direction', direction);
    return NextResponse.json({ success: true, direction });
  } catch (error) {
    console.error('Set swipe setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
