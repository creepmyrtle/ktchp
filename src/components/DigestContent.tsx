'use client';

import { useState } from 'react';
import type { ArticleWithSource } from '@/types';
import DigestHeader from './DigestHeader';
import ArticleCard from './ArticleCard';
import CaughtUpMessage from './CaughtUpMessage';

interface DigestContentProps {
  date: string | Date;
  articles: ArticleWithSource[];
  stats: {
    total_article_count: number;
    archived_count: number;
    remaining_count: number;
    liked_count: number;
    neutral_count: number;
    disliked_count: number;
    bookmarked_count: number;
  };
  children?: React.ReactNode;
}

export default function DigestContent({ date, articles, stats, children }: DigestContentProps) {
  const [archivedCount, setArchivedCount] = useState(stats.archived_count);
  const totalCount = stats.total_article_count;

  function handleArticleArchived() {
    setArchivedCount(prev => prev + 1);
  }

  const allCleared = archivedCount === totalCount && totalCount > 0;

  return (
    <>
      <DigestHeader
        date={date}
        articleCount={totalCount - archivedCount}
        archivedCount={archivedCount}
        totalCount={totalCount}
      />

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
        likedCount={stats.liked_count}
        neutralCount={stats.neutral_count}
        dislikedCount={stats.disliked_count}
        bookmarkedCount={stats.bookmarked_count}
      />
    </>
  );
}
