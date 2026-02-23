'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserArticleWithSource } from '@/types';
import DigestHeader from './DigestHeader';
import ArticleCard from './ArticleCard';
import CaughtUpMessage from './CaughtUpMessage';

type Stats = {
  total_article_count: number;
  archived_count: number;
  remaining_count: number;
  liked_count: number;
  skipped_count: number;
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
  const [swipeHintDismissed, setSwipeHintDismissed] = useState(true);
  const [bonusExpanded, setBonusExpanded] = useState(false);
  const [reversed, setReversed] = useState(false);
  const totalCount = stats.total_article_count;
  const bonusTotalCount = bonusStats?.total_article_count ?? 0;

  useEffect(() => {
    fetch('/api/settings/swipe')
      .then(r => r.json())
      .then(data => {
        setReversed(data.reversed === true);
      })
      .catch(() => {});

    // Check if swipe hint has been dismissed
    fetch('/api/settings/swipe-hint')
      .then(r => r.json())
      .then(data => {
        setSwipeHintDismissed(data.dismissed === true);
      })
      .catch(() => {});
  }, []);

  const handleArticleArchived = useCallback(() => {
    setArchivedCount(prev => prev + 1);
    // Dismiss swipe hint on first swipe
    if (!swipeHintDismissed) {
      setSwipeHintDismissed(true);
      fetch('/api/settings/swipe-hint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      }).catch(() => {});
    }
  }, [swipeHintDismissed]);

  const handleArticleUnarchived = useCallback(() => {
    setArchivedCount(prev => Math.max(0, prev - 1));
  }, []);

  function handleBonusArticleArchived() {
    setBonusArchivedCount(prev => prev + 1);
  }

  function handleBonusArticleUnarchived() {
    setBonusArchivedCount(prev => Math.max(0, prev - 1));
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

      {/* First-time swipe hint */}
      {!swipeHintDismissed && articles.length > 0 && (
        <div className="sm:hidden text-xs text-muted mt-3 flex items-center justify-between bg-card border border-card-border rounded-lg px-3 py-2">
          <span>
            {reversed
              ? '\u2190 Like \u00B7 Skip \u2192'
              : '\u2190 Skip \u00B7 Like \u2192'}
          </span>
          <button onClick={() => {
            setSwipeHintDismissed(true);
            fetch('/api/settings/swipe-hint', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dismissed: true }),
            }).catch(() => {});
          }} className="ml-2 text-muted hover:text-foreground">&times;</button>
        </div>
      )}

      {children}

      {/* Section header */}
      {articles.length > 0 && (
        <div className="mt-6 mb-4">
          <p className="text-sm text-muted">
            Articles picked for you based on your interests. Swipe to rate and archive.
          </p>
        </div>
      )}

      {/* Recommended articles */}
      <div className="flex flex-col gap-4">
        {recommendedArticles.map(article => (
          <ArticleCard
            key={article.id}
            article={article}
            reversed={reversed}
            onArchived={handleArticleArchived}
            onUnarchived={handleArticleUnarchived}
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
                reversed={reversed}
                onArchived={handleArticleArchived}
                onUnarchived={handleArticleUnarchived}
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

      {/* Bonus digest section — visible after main is complete but bonus is not yet cleared */}
      {bonusTotalCount > 0 && allCleared && !allBonusCleared && (
        <div className="mt-2">
          {!bonusExpanded ? (
            /* Bonus available but not yet expanded */
            <div className="rounded-lg border border-slate-500/30 bg-card p-5 text-center">
              <p className="text-foreground font-light text-base mb-1">
                {bonusTotalCount - bonusArchivedCount} more article{bonusTotalCount - bonusArchivedCount !== 1 ? 's' : ''}
              </p>
              <p className="text-muted text-sm mb-4">
                These didn&apos;t make your main digest but browsing them helps ketchup learn what you like.
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
                    reversed={reversed}
                    tier="bonus"
                    onArchived={handleBonusArticleArchived}
                    onUnarchived={handleBonusArticleUnarchived}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Caught up / completion message — only after all articles (main + bonus) are cleared */}
      {allCleared && (bonusTotalCount === 0 || allBonusCleared) && (
        <CaughtUpMessage
          isComplete={true}
          totalCount={totalCount + bonusTotalCount}
          likedCount={liveStats.liked_count}
          skippedCount={liveStats.skipped_count}
          bookmarkedCount={liveStats.bookmarked_count}
        />
      )}
    </>
  );
}
