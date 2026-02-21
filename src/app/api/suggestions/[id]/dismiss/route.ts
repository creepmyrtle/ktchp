import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSuggestionById, dismissSuggestion } from '@/lib/db/suggestions';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const suggestion = await getSuggestionById(id);
    if (!suggestion || suggestion.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (suggestion.status !== 'pending') {
      return NextResponse.json({ error: 'Suggestion already resolved' }, { status: 400 });
    }

    await dismissSuggestion(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Dismiss suggestion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
