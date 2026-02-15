import { redirect, notFound } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';
import { getDefaultUser } from '@/lib/db/users';
import { getDigestById, getRecentDigests } from '@/lib/db/digests';
import { getArticlesByDigestId, getDigestCompletionStats } from '@/lib/db/articles';
import DigestHeader from '@/components/DigestHeader';
import ArticleCard from '@/components/ArticleCard';
import CaughtUpMessage from '@/components/CaughtUpMessage';
import DigestSelector from '@/components/DigestSelector';
import Link from 'next/link';

export default async function DigestByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  await seedDatabase();
  const user = await getDefaultUser();
  if (!user) redirect('/');

  const { id } = await params;
  const digest = await getDigestById(id);
  if (!digest) notFound();

  const articles = await getArticlesByDigestId(digest.id);
  const stats = await getDigestCompletionStats(digest.id);
  const recentDigests = await getRecentDigests(user.id, 14, digest.provider);

  const enrichedDigests = await Promise.all(
    recentDigests.map(async (d) => {
      const s = await getDigestCompletionStats(d.id);
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
          <h1 className="text-lg font-light tracking-tight">ktchp</h1>
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
        <DigestHeader
          date={digest.generated_at}
          articleCount={articles.length}
          archivedCount={stats.archived_count}
          totalCount={stats.total_article_count}
        />

        <DigestSelector digests={enrichedDigests} currentId={digest.id} />

        <div className="flex flex-col gap-4 mt-6">
          {articles.map(article => (
            <ArticleCard
              key={article.id}
              article={article}
            />
          ))}
        </div>

        <CaughtUpMessage
          isComplete={stats.remaining_count === 0 && stats.total_article_count > 0}
          totalCount={stats.total_article_count}
          likedCount={stats.liked_count}
          neutralCount={stats.neutral_count}
          dislikedCount={stats.disliked_count}
          bookmarkedCount={stats.bookmarked_count}
        />
      </main>
    </div>
  );
}
