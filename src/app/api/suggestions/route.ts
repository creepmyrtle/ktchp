import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getPendingSuggestions } from '@/lib/db/suggestions';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const suggestions = await getPendingSuggestions(userId);
    return NextResponse.json(suggestions);
  } catch (error) {
    console.error('Suggestions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
