import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';
import { getDefaultUser } from '@/lib/db/users';
import { getLatestDigest, getRecentDigests } from '@/lib/db/digests';
import { getArticlesByDigestId } from '@/lib/db/articles';
import { getFeedbackByUserId } from '@/lib/db/feedback';
import { getActiveProvider } from '@/lib/llm';
import DigestHeader from '@/components/DigestHeader';
import ArticleCard from '@/components/ArticleCard';
import CaughtUpMessage from '@/components/CaughtUpMessage';
import IngestButton from '@/components/IngestButton';
import PreviousDigests from '@/components/PreviousDigests';
import ProviderToggle from '@/components/ProviderToggle';
import Link from 'next/link';

export default async function DigestPage() {
  const userId = await getSessionFromCookies();
  if (!userId) redirect('/');

  await seedDatabase();
  const user = await getDefaultUser();
  if (!user) redirect('/');

  const provider = await getActiveProvider();
  const latestDigest = await getLatestDigest(user.id, provider);
  const recentDigests = await getRecentDigests(user.id, 5, provider);
  const articles = latestDigest ? await getArticlesByDigestId(latestDigest.id) : [];
  const userFeedback = await getFeedbackByUserId(user.id, 200);

  // Build a set of feedback actions per article
  const feedbackMap = new Map<string, Set<string>>();
  for (const fb of userFeedback) {
    if (!feedbackMap.has(fb.article_id)) {
      feedbackMap.set(fb.article_id, new Set());
    }
    feedbackMap.get(fb.article_id)!.add(fb.action);
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <h1 className="text-lg font-light tracking-tight">ktchp</h1>
        <div className="flex gap-4 items-center">
          <ProviderToggle />
          <Link href="/settings" className="text-sm text-muted hover:text-foreground transition-colors">
            Settings
          </Link>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-sm text-muted hover:text-foreground transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {latestDigest ? (
          <>
            <DigestHeader
              date={latestDigest.generated_at}
              articleCount={articles.length}
            />

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

            <IngestButton />

            <PreviousDigests digests={recentDigests.slice(1)} />
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted text-lg mb-4">No digests yet</p>
            <p className="text-muted text-sm">
              Fetch articles from your sources and generate your first digest.
            </p>
            <IngestButton />
          </div>
        )}
      </main>
    </div>
  );
}
