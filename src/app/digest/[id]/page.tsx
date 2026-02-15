import { redirect, notFound } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';
import { getDefaultUser } from '@/lib/db/users';
import { getDigestById, getRecentDigests } from '@/lib/db/digests';
import { getArticlesByDigestId, getDigestCompletionStats } from '@/lib/db/articles';
import DigestContent from '@/components/DigestContent';
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
          date={digest.generated_at}
          articles={articles}
          stats={stats}
        >
          <DigestSelector digests={enrichedDigests} currentId={digest.id} />
        </DigestContent>
      </main>
    </div>
  );
}
