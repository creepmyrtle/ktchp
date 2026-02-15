import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getPreferencesByUserId } from '@/lib/db/preferences';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getDefaultUser();
    if (!user) return NextResponse.json([], { status: 200 });

    const preferences = await getPreferencesByUserId(user.id);
    return NextResponse.json(preferences);
  } catch (error) {
    console.error('Preferences error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
