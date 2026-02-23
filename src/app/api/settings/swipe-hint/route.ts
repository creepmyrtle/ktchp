import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/db/settings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dismissed = await getSetting(userId, 'swipe_hint_dismissed');
    return NextResponse.json({ dismissed: dismissed === 'true' });
  } catch (error) {
    console.error('Get swipe hint setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { dismissed } = await request.json();
    await setSetting(userId, 'swipe_hint_dismissed', String(!!dismissed));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Set swipe hint setting error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
