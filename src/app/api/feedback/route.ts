import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { logFeedbackEvent } from '@/lib/db/feedback';
import {
  getArticleById,
  updateArticleSentiment,
  updateArticleRead,
  updateArticleBookmark,
  archiveArticle,
} from '@/lib/db/articles';
import type { FeedbackAction, Sentiment } from '@/types';

const VALID_ACTIONS: FeedbackAction[] = ['liked', 'neutral', 'disliked', 'read', 'bookmark', 'unbookmark', 'archived'];
const SENTIMENTS: Sentiment[] = ['liked', 'neutral', 'disliked'];

/** Best-effort event log — never throw */
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

    const article = await getArticleById(articleId);
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    // Handle sentiment (liked / neutral / disliked) — three-way toggle
    if (SENTIMENTS.includes(action as Sentiment)) {
      const sentiment = action as Sentiment;
      const newSentiment = article.sentiment === sentiment ? null : sentiment;
      const state = await updateArticleSentiment(articleId, newSentiment);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle read toggle
    if (action === 'read') {
      const state = await updateArticleRead(articleId, !article.is_read);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle bookmark
    if (action === 'bookmark') {
      const state = await updateArticleBookmark(articleId, true);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle unbookmark
    if (action === 'unbookmark') {
      const state = await updateArticleBookmark(articleId, false);
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    // Handle archive — requires sentiment
    if (action === 'archived') {
      if (!article.sentiment) {
        return NextResponse.json(
          { error: 'Sentiment required before archiving' },
          { status: 400 }
        );
      }
      const state = await archiveArticle(articleId);
      if (!state) {
        return NextResponse.json({ error: 'Failed to archive' }, { status: 500 });
      }
      await logEvent(userId, articleId, action);
      return NextResponse.json({ success: true, ...state });
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
