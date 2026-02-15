import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getPreferencesByUserId } from '@/lib/db/preferences';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const preferences = await getPreferencesByUserId(userId);
    return NextResponse.json(preferences);
  } catch (error) {
    console.error('Preferences error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
