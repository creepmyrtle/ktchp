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
  stats: Stats;
  children?: React.ReactNode;
}

export default function DigestContent({ digestId, date, articles, stats, children }: DigestContentProps) {
  const [archivedCount, setArchivedCount] = useState(stats.archived_count);
  const [liveStats, setLiveStats] = useState<Stats>(stats);
  const [hintDismissed, setHintDismissed] = useState(false);
  const totalCount = stats.total_article_count;

  function handleArticleArchived() {
    setArchivedCount(prev => prev + 1);
  }

  const allCleared = archivedCount === totalCount && totalCount > 0;

  // Fetch fresh stats from server when digest is fully cleared
  useEffect(() => {
    if (!allCleared) return;
    fetch(`/api/digests/${digestId}/stats`)
      .then(r => r.json())
      .then(data => { if (data.total_article_count) setLiveStats(data); })
      .catch(() => {});
  }, [allCleared, digestId]);

  return (
    <>
      <DigestHeader
        date={date}
        articleCount={totalCount - archivedCount}
        archivedCount={archivedCount}
        totalCount={totalCount}
      />

      {!hintDismissed && articles.length > 0 && (
        <p className="sm:hidden text-xs text-muted mt-3 flex items-center justify-between">
          <span>Rate articles, then swipe to archive</span>
          <button onClick={() => setHintDismissed(true)} className="ml-2 text-muted hover:text-foreground">&times;</button>
        </p>
      )}

      {children}

      <div className="flex flex-col gap-4 mt-6">
        {articles.map(article => (
          <ArticleCard
            key={article.id}
            article={article}
            onArchived={handleArticleArchived}
          />
        ))}
      </div>

      <CaughtUpMessage
        isComplete={allCleared}
        totalCount={totalCount}
        likedCount={liveStats.liked_count}
        neutralCount={liveStats.neutral_count}
        dislikedCount={liveStats.disliked_count}
        bookmarkedCount={liveStats.bookmarked_count}
      />
    </>
  );
}
