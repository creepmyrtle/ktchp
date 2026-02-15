import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getBookmarkedArticles, getFeedbackByUserId } from '@/lib/db/feedback';
import ArticleCard from '@/components/ArticleCard';
import Link from 'next/link';
import type { ArticleWithSource } from '@/types';

export default async function BookmarksPage() {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  const user = await getDefaultUser();
  if (!user) redirect('/');

  const bookmarkedArticles = await getBookmarkedArticles(user.id) as ArticleWithSource[];
  const userFeedback = await getFeedbackByUserId(user.id, 200);

  const feedbackMap = new Map<string, Set<string>>();
  for (const fb of userFeedback) {
    if (!feedbackMap.has(fb.article_id)) {
      feedbackMap.set(fb.article_id, new Set());
    }
    feedbackMap.get(fb.article_id)!.add(fb.action);
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-light tracking-tight">ktchp</h1>
          <div className="flex gap-3 sm:gap-4 items-center">
            <Link href="/digest" className="text-sm text-accent hover:opacity-80 transition-opacity">
              Latest
            </Link>
            <Link href="/digest/bookmarks" className="text-sm text-accent hover:opacity-80 transition-opacity">
              Bookmarks
            </Link>
            <Link href="/settings" className="text-sm text-muted hover:text-foreground transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-light tracking-tight mb-6">Bookmarks</h2>

        {bookmarkedArticles.length > 0 ? (
          <div className="flex flex-col gap-4">
            {bookmarkedArticles.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                initialFeedback={Array.from(feedbackMap.get(article.id) || [])}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted text-lg mb-2">No bookmarks yet</p>
            <p className="text-muted text-sm">
              Bookmark articles from your digests and they&#39;ll appear here.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
