import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { createFeedback, deleteFeedback, getFeedbackForArticle } from '@/lib/db/feedback';
import type { FeedbackAction } from '@/types';

const VALID_ACTIONS: FeedbackAction[] = ['thumbs_up', 'thumbs_down', 'bookmark', 'dismiss', 'click'];
const TOGGLEABLE_ACTIONS: FeedbackAction[] = ['thumbs_up', 'thumbs_down', 'bookmark'];

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

    // Toggleable actions: check if already exists, delete if so
    if (TOGGLEABLE_ACTIONS.includes(action)) {
      const existing = await getFeedbackForArticle(userId, articleId);
      const hasAction = existing.some((fb) => fb.action === action);

      if (hasAction) {
        await deleteFeedback(userId, articleId, action);
        return NextResponse.json({ success: true, toggled: 'off' });
      }

      // Thumbs mutual exclusivity: remove the opposite thumb
      if (action === 'thumbs_up') {
        const hasDown = existing.some((fb) => fb.action === 'thumbs_down');
        if (hasDown) await deleteFeedback(userId, articleId, 'thumbs_down');
      } else if (action === 'thumbs_down') {
        const hasUp = existing.some((fb) => fb.action === 'thumbs_up');
        if (hasUp) await deleteFeedback(userId, articleId, 'thumbs_up');
      }

      const feedback = await createFeedback(userId, articleId, action);
      return NextResponse.json({ success: true, toggled: 'on', feedback });
    }

    // Non-toggleable actions (dismiss, click): create-only
    const feedback = await createFeedback(userId, articleId, action);
    return NextResponse.json({ success: true, feedback });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
