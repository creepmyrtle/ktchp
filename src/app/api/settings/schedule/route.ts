import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSchedule, setSchedule } from '@/lib/db/settings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const times = await getSchedule(userId);
    return NextResponse.json({ times });
  } catch (error) {
    console.error('Get schedule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { times } = await request.json();
    if (!Array.isArray(times) || times.length === 0) {
      return NextResponse.json({ error: 'At least one time required' }, { status: 400 });
    }

    // Validate HH:MM format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    for (const t of times) {
      if (!timeRegex.test(t)) {
        return NextResponse.json({ error: `Invalid time format: ${t}` }, { status: 400 });
      }
    }

    await setSchedule(userId, times);
    return NextResponse.json({ success: true, times });
  } catch (error) {
    console.error('Set schedule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
