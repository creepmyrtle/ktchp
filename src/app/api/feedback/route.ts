import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { createFeedback } from '@/lib/db/feedback';
import type { FeedbackAction } from '@/types';

const VALID_ACTIONS: FeedbackAction[] = ['thumbs_up', 'thumbs_down', 'bookmark', 'dismiss', 'click'];

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { articleId, action } = await request.json();

    if (!articleId || !action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const feedback = await createFeedback(userId, articleId, action);
    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
