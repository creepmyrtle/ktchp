import { redirect, notFound } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';
import { getDefaultUser } from '@/lib/db/users';
import { getDigestById, getRecentDigests } from '@/lib/db/digests';
import { getArticlesByDigestId } from '@/lib/db/articles';
import { getFeedbackByUserId } from '@/lib/db/feedback';
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
  const recentDigests = await getRecentDigests(user.id, 14, digest.provider);
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
            <Link href="/settings" className="text-sm text-muted hover:text-foreground transition-colors">
              Settings
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <DigestHeader
          date={digest.generated_at}
          articleCount={articles.length}
        />

        <DigestSelector digests={recentDigests} currentId={digest.id} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {articles.map(article => (
            <ArticleCard
              key={article.id}
              article={article}
              initialFeedback={Array.from(feedbackMap.get(article.id) || [])}
            />
          ))}
        </div>

        <CaughtUpMessage />
      </main>
    </div>
  );
}
