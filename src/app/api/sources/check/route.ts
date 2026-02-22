import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { validateRssFeed } from '@/lib/ingestion/rss';
import { timeAgo } from '@/lib/utils/time';

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL required' }, { status: 400 });
    }

    const result = await validateRssFeed(url.trim());

    if (!result.valid) {
      return NextResponse.json({
        valid: false,
        title: null,
        article_count: 0,
        recent_count: 0,
        newest_article_age: null,
        error: result.error || 'This URL doesn\'t appear to be a valid RSS or Atom feed.',
        warnings: [],
      });
    }

    const now = Date.now();
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

    const recentArticles = result.articles.filter(a => {
      if (!a.published_at) return true; // no date = assume recent
      const pubDate = new Date(a.published_at).getTime();
      return (now - pubDate) < FOURTEEN_DAYS;
    });

    // Find newest article age
    let newestArticleAge: string | null = null;
    if (result.articles.length > 0) {
      const dates = result.articles
        .map(a => a.published_at)
        .filter((d): d is string => d !== null)
        .map(d => new Date(d).getTime());
      if (dates.length > 0) {
        const newest = Math.max(...dates);
        newestArticleAge = timeAgo(new Date(newest).toISOString());
      }
    }

    // Generate warnings
    const warnings: string[] = [];

    if (result.articles.length === 0) {
      warnings.push('This feed appears to be empty. It may not be a valid RSS feed.');
    } else if (recentArticles.length === 0) {
      warnings.push(
        `This feed's most recent article is from ${newestArticleAge || 'a while'} ago. ketchup focuses on content from the last 14 days, so this source may not contribute to your daily digest.`
      );
    } else if (recentArticles.length < 3) {
      warnings.push(
        `This feed only has ${recentArticles.length} recent article${recentArticles.length !== 1 ? 's' : ''}. It may not contribute to most of your daily digests.`
      );
    }

    // Check if articles lack content
    const hasContent = result.articles.some(a => a.content && a.content.trim().length > 0);
    if (result.articles.length > 0 && !hasContent) {
      warnings.push(
        'This feed\'s articles don\'t include content snippets. ketchup may have difficulty assessing article relevance.'
      );
    }

    return NextResponse.json({
      valid: true,
      title: result.title,
      article_count: result.articles.length,
      recent_count: recentArticles.length,
      newest_article_age: newestArticleAge,
      error: null,
      warnings,
    });
  } catch (error) {
    console.error('Source check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
