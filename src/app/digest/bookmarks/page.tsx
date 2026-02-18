import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { getBookmarkedArticles } from '@/lib/db/feedback';
import BookmarkCard from '@/components/BookmarkCard';
import Link from 'next/link';

export default async function BookmarksPage() {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  const bookmarkedArticles = await getBookmarkedArticles(userId);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Link href="/digest" className="text-lg font-light tracking-tight hover:opacity-80 transition-opacity">ktchp</Link>
          <Link href="/digest" className="text-sm text-accent hover:opacity-80 transition-opacity">
            Back to digest
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 animate-fade-up">
        <h2 className="text-2xl font-light tracking-tight mb-6">Bookmarks</h2>

        {bookmarkedArticles.length > 0 ? (
          <div className="flex flex-col gap-4">
            {bookmarkedArticles.map((article) => (
              <BookmarkCard key={article.id} article={article} />
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
