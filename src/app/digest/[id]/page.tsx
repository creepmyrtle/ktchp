import { redirect, notFound } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { getDigestById, getRecentDigests } from '@/lib/db/digests';
import { getUserArticlesByDigestId, getDigestCompletionStats } from '@/lib/db/user-articles';
import DigestContent from '@/components/DigestContent';
import DigestSelector from '@/components/DigestSelector';
import Link from 'next/link';

export default async function DigestByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  const { id } = await params;
  const digest = await getDigestById(id);
  if (!digest) notFound();

  // Ownership check
  if (digest.user_id !== userId) notFound();

  const articles = await getUserArticlesByDigestId(userId, digest.id, false, ['recommended', 'serendipity']);
  const bonusArticles = await getUserArticlesByDigestId(userId, digest.id, false, 'bonus');
  const stats = await getDigestCompletionStats(userId, digest.id, ['recommended', 'serendipity']);
  const bonusStats = await getDigestCompletionStats(userId, digest.id, 'bonus');
  const recentDigests = await getRecentDigests(userId, 14, digest.provider);

  const enrichedDigests = await Promise.all(
    recentDigests.map(async (d) => {
      const [mainStats, bStats] = await Promise.all([
        getDigestCompletionStats(userId, d.id, ['recommended', 'serendipity']),
        getDigestCompletionStats(userId, d.id, 'bonus'),
      ]);
      return {
        ...d,
        main_count: mainStats.total_article_count,
        remaining_count: mainStats.remaining_count,
        is_complete: mainStats.remaining_count === 0 && mainStats.total_article_count > 0,
        bonus_count: bStats.total_article_count,
        bonus_remaining: bStats.remaining_count,
      };
    })
  );

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Link href="/digest" className="text-lg font-light tracking-tight hover:opacity-80 transition-opacity">ktchp</Link>
          <div className="flex gap-3 sm:gap-4 items-center">
            <Link href="/digest" className="text-sm text-accent hover:opacity-80 transition-opacity">
              Latest
            </Link>
            <Link href="/digest/bookmarks" className="text-sm text-muted hover:text-foreground transition-colors">
              Bookmarks
            </Link>
            <Link href="/settings" className="text-sm text-muted hover:text-foreground transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 animate-fade-up">
        <DigestContent
          digestId={digest.id}
          date={digest.generated_at}
          articles={articles}
          bonusArticles={bonusArticles}
          stats={stats}
          bonusStats={bonusStats}
        >
          <DigestSelector digests={enrichedDigests} currentId={digest.id} />
        </DigestContent>
      </main>
    </div>
  );
}
