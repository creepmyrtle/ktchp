import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { logFeedbackEvent } from '@/lib/db/feedback';
import {
  getUserArticleByArticleId,
  updateUserArticleSentiment,
  updateUserArticleRead,
  updateUserArticleBookmark,
  archiveUserArticle,
  unarchiveUserArticle,
} from '@/lib/db/user-articles';
import type { FeedbackAction, Sentiment } from '@/types';

const VALID_ACTIONS: FeedbackAction[] = ['liked', 'skipped', 'read', 'bookmark', 'unbookmark', 'archived', 'unarchived'];
const SENTIMENTS: Sentiment[] = ['liked', 'skipped'];

async function logEvent(userId: string, articleId: string, action: FeedbackAction) {
  try {
    await logFeedbackEvent(userId, articleId, action);
  } catch (e) {
    console.warn('Failed to log feedback event:', e);
  }
}

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

    // Verify user_articles row exists and belongs to this user
    const userArticle = await getUserArticleByArticleId(userId, articleId);
    if (!userArticle) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    // Handle sentiment (liked / skipped) — two-way toggle
    if (SENTIMENTS.includes(action as Sentiment)) {
      const sentiment = action as Sentiment;
      const newSentiment = userArticle.sentiment === sentiment ? null : sentiment;
      const state = await updateUserArticleSentiment(userId, articleId, newSentiment);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle read toggle
    if (action === 'read') {
      const state = await updateUserArticleRead(userId, articleId, !userArticle.is_read);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle bookmark
    if (action === 'bookmark') {
      const state = await updateUserArticleBookmark(userId, articleId, true);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle unbookmark
    if (action === 'unbookmark') {
      const state = await updateUserArticleBookmark(userId, articleId, false);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle archive
    if (action === 'archived') {
      const state = await archiveUserArticle(userId, articleId);
      if (!state) {
        return NextResponse.json({ error: 'Failed to archive' }, { status: 500 });
      }
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle unarchive (undo)
    if (action === 'unarchived') {
      const state = await unarchiveUserArticle(userId, articleId);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
