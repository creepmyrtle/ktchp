'use client';

import { useState, useEffect } from 'react';
import type { UserArticleWithSource } from '@/types';
import DigestHeader from './DigestHeader';
import ArticleCard from './ArticleCard';
import CaughtUpMessage from './CaughtUpMessage';

type Stats = {
  total_article_count: number;
  archived_count: number;
  remaining_count: number;
  liked_count: number;
  neutral_count: number;
  disliked_count: number;
  bookmarked_count: number;
};

interface DigestContentProps {
  digestId: string;
  date: string | Date;
  articles: UserArticleWithSource[];
  bonusArticles?: UserArticleWithSource[];
  stats: Stats;
  bonusStats?: Stats;
  children?: React.ReactNode;
}

export default function DigestContent({ digestId, date, articles, bonusArticles = [], stats, bonusStats, children }: DigestContentProps) {
  const [archivedCount, setArchivedCount] = useState(stats.archived_count);
  const [bonusArchivedCount, setBonusArchivedCount] = useState(bonusStats?.archived_count ?? 0);
  const [liveStats, setLiveStats] = useState<Stats>(stats);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [bonusExpanded, setBonusExpanded] = useState(false);
  const totalCount = stats.total_article_count;
  const bonusTotalCount = bonusStats?.total_article_count ?? 0;

  function handleArticleArchived() {
    setArchivedCount(prev => prev + 1);
  }

  function handleBonusArticleArchived() {
    setBonusArchivedCount(prev => prev + 1);
  }

  const allCleared = archivedCount === totalCount && totalCount > 0;
  const allBonusCleared = bonusArchivedCount === bonusTotalCount && bonusTotalCount > 0;

  // Fetch fresh stats from server when main digest is fully cleared
  useEffect(() => {
    if (!allCleared) return;
    fetch(`/api/digests/${digestId}/stats`)
      .then(r => r.json())
      .then(data => { if (data.total_article_count) setLiveStats(data); })
      .catch(() => {});
  }, [allCleared, digestId]);

  // Separate recommended from serendipity articles
  const recommendedArticles = articles.filter(a => a.digest_tier !== 'serendipity');
  const serendipityArticles = articles.filter(a => a.digest_tier === 'serendipity');

  return (
    <>
      <DigestHeader
        date={date}
        articleCount={totalCount - archivedCount}
        archivedCount={archivedCount}
        totalCount={totalCount}
        bonusTotalCount={bonusTotalCount}
        bonusArchivedCount={bonusArchivedCount}
      />

      {!hintDismissed && articles.length > 0 && (
        <p className="sm:hidden text-xs text-muted mt-3 flex items-center justify-between">
          <span>Rate articles, then swipe to archive</span>
          <button onClick={() => setHintDismissed(true)} className="ml-2 text-muted hover:text-foreground">&times;</button>
        </p>
      )}

      {children}

      {/* Section header */}
      {articles.length > 0 && (
        <div className="mt-6 mb-4">
          <p className="text-sm text-muted">
            Articles picked for you based on your interests. Rate each one to help ktchp learn your preferences.
          </p>
        </div>
      )}

      {/* Recommended articles */}
      <div className="flex flex-col gap-4">
        {recommendedArticles.map(article => (
          <ArticleCard
            key={article.id}
            article={article}
            onArchived={handleArticleArchived}
          />
        ))}
      </div>

      {/* Serendipity divider + articles */}
      {serendipityArticles.length > 0 && (
        <>
          <div className="flex items-center gap-3 my-6 text-xs text-muted">
            <div className="flex-1 border-t border-card-border" />
            <span>Serendipity picks &mdash; interesting finds outside your usual interests</span>
            <div className="flex-1 border-t border-card-border" />
          </div>
          <div className="flex flex-col gap-4">
            {serendipityArticles.map(article => (
              <ArticleCard
                key={article.id}
                article={article}
                onArchived={handleArticleArchived}
              />
            ))}
          </div>
        </>
      )}

      {/* Pre-completion bonus teaser */}
      {bonusTotalCount > 0 && !allCleared && (
        <div className="flex items-center gap-3 mt-8 text-xs text-muted">
          <div className="flex-1 border-t border-card-border" />
          <span>{bonusTotalCount} bonus article{bonusTotalCount !== 1 ? 's' : ''} available after you finish your digest</span>
          <div className="flex-1 border-t border-card-border" />
        </div>
      )}

      {/* Caught up / completion message */}
      <CaughtUpMessage
        isComplete={allCleared}
        totalCount={totalCount}
        likedCount={liveStats.liked_count}
        neutralCount={liveStats.neutral_count}
        dislikedCount={liveStats.disliked_count}
        bookmarkedCount={liveStats.bookmarked_count}
      />

      {/* Bonus digest section — visible after main digest is complete */}
      {bonusTotalCount > 0 && allCleared && (
        <div className="mt-2">
          {allBonusCleared ? (
            /* All bonus articles already reviewed */
            <div className="text-center py-8 border-t border-card-border">
              <p className="text-muted text-sm">Bonus complete &mdash; You reviewed all {bonusTotalCount} additional articles.</p>
            </div>
          ) : !bonusExpanded ? (
            /* Bonus available but not yet expanded */
            <div className="rounded-lg border border-slate-500/30 bg-card p-5 text-center">
              <p className="text-foreground font-light text-base mb-1">
                {bonusTotalCount - bonusArchivedCount} more article{bonusTotalCount - bonusArchivedCount !== 1 ? 's' : ''}
              </p>
              <p className="text-muted text-sm mb-4">
                These didn&apos;t make your main digest but browsing them helps ktchp learn what you like.
                Your feedback here directly improves future recommendations.
              </p>
              <button
                onClick={() => setBonusExpanded(true)}
                className="px-4 py-1.5 text-sm rounded-full border border-slate-500/50 text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                Browse bonus articles
              </button>
            </div>
          ) : (
            /* Bonus expanded — show cards */
            <>
              <div className="flex items-center gap-3 mb-4 text-xs text-muted">
                <div className="flex-1 border-t border-slate-500/30" />
                <span>Bonus &mdash; {bonusArchivedCount} of {bonusTotalCount} reviewed</span>
                <div className="flex-1 border-t border-slate-500/30" />
              </div>
              <div className="flex flex-col gap-4">
                {bonusArticles.map(article => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    tier="bonus"
                    onArchived={handleBonusArticleArchived}
                  />
                ))}
              </div>
              {allBonusCleared && (
                <div className="text-center py-8 mt-4 border-t border-card-border">
                  <p className="text-muted text-sm">Bonus complete &mdash; You reviewed all {bonusTotalCount} additional articles.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
