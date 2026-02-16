import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { getLatestDigest, getRecentDigests } from '@/lib/db/digests';
import { getUserArticlesByDigestId, getDigestCompletionStats } from '@/lib/db/user-articles';
import { getActiveProvider } from '@/lib/llm';
import { getUserById } from '@/lib/db/users';
import DigestContent from '@/components/DigestContent';
import DigestSelector from '@/components/DigestSelector';
import Link from 'next/link';

export default async function DigestPage() {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  const user = await getUserById(userId);
  if (!user) redirect('/');

  const provider = await getActiveProvider();
  const latestDigest = await getLatestDigest(userId, provider);
  const recentDigests = await getRecentDigests(userId, 14, provider);
  const articles = latestDigest ? await getUserArticlesByDigestId(userId, latestDigest.id, false, ['recommended', 'serendipity']) : [];
  const bonusArticles = latestDigest ? await getUserArticlesByDigestId(userId, latestDigest.id, false, 'bonus') : [];
  const stats = latestDigest ? await getDigestCompletionStats(userId, latestDigest.id, ['recommended', 'serendipity']) : null;
  const bonusStats = latestDigest ? await getDigestCompletionStats(userId, latestDigest.id, 'bonus') : null;

  // Enrich recent digests with completion info (main digest only)
  const enrichedDigests = await Promise.all(
    recentDigests.map(async (d) => {
      const s = await getDigestCompletionStats(userId, d.id, ['recommended', 'serendipity']);
      return {
        ...d,
        remaining_count: s.remaining_count,
        is_complete: s.remaining_count === 0 && s.total_article_count > 0,
      };
    })
  );

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Link href="/digest" className="text-lg font-light tracking-tight hover:opacity-80 transition-opacity">ktchp</Link>
          <div className="flex gap-3 sm:gap-4 items-center">
            {user.display_name && (
              <span className="text-sm text-muted hidden sm:inline">{user.display_name}</span>
            )}
            <Link href="/digest/bookmarks" className="text-sm text-muted hover:text-foreground transition-colors">
              Bookmarks
            </Link>
            <Link href="/settings" className="text-sm text-muted hover:text-foreground transition-colors">
              Settings
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-sm text-muted hover:text-foreground transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 animate-fade-up">
        {latestDigest ? (
          <>
            <DigestContent
              digestId={latestDigest.id}
              date={latestDigest.generated_at}
              articles={articles}
              bonusArticles={bonusArticles}
              stats={stats || { total_article_count: 0, archived_count: 0, remaining_count: 0, liked_count: 0, neutral_count: 0, disliked_count: 0, bookmarked_count: 0 }}
              bonusStats={bonusStats || { total_article_count: 0, archived_count: 0, remaining_count: 0, liked_count: 0, neutral_count: 0, disliked_count: 0, bookmarked_count: 0 }}
            >
              <DigestSelector digests={enrichedDigests} currentId={latestDigest.id} />
            </DigestContent>
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted text-lg mb-4">No digests yet</p>
            <p className="text-muted text-sm">
              Your first digest is on its way! Check back soon, or customize your interests and sources in Settings.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
