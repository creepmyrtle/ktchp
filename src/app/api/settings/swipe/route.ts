import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/db/settings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const reversedStr = await getSetting(userId, 'swipe_reversed');
    // Migration: if old direction setting exists, convert it
    if (reversedStr === null) {
      const oldDirection = await getSetting(userId, 'swipe_archive_direction');
      const reversed = oldDirection === 'left';
      return NextResponse.json({ reversed });
    }
    return NextResponse.json({ reversed: reversedStr === 'true' });
  } catch (error) {
    console.error('Get swipe setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { reversed } = await request.json();
    if (typeof reversed !== 'boolean') {
      return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    }

    await setSetting(userId, 'swipe_reversed', String(reversed));
    return NextResponse.json({ success: true, reversed });
  } catch (error) {
    console.error('Set swipe setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
