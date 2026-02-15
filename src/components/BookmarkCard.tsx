'use client';

import { useState } from 'react';
import type { UserArticleWithSource } from '@/types';
import { useToast } from './Toast';

interface BookmarkCardProps {
  article: UserArticleWithSource;
}

export default function BookmarkCard({ article }: BookmarkCardProps) {
  const [removed, setRemoved] = useState(false);
  const { showToast } = useToast();

  function handleUnbookmark() {
    setRemoved(true);
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: 'unbookmark' }),
    }).catch(() => {
      setRemoved(false);
      showToast('Failed to remove bookmark', 'error');
    });
  }

  function handleShare() {
    navigator.clipboard.writeText(article.url).then(
      () => showToast('Link copied!'),
      () => showToast('Failed to copy', 'error')
    );
  }

  if (removed) return null;

  const isSerendipity = !!article.is_serendipity;

  return (
    <div className={`rounded-lg border p-4 bg-card card-hover ${
      isSerendipity ? 'border-serendipity/40 card-hover-serendipity' : 'border-card-border'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <span className="text-xs text-muted">{article.source_name}</span>
        {article.sentiment && (
          <span className="text-xs text-muted">
            {article.sentiment === 'liked' ? '\uD83D\uDC4D' : article.sentiment === 'disliked' ? '\uD83D\uDC4E' : '\u2796'} {article.sentiment}
          </span>
        )}
      </div>

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium leading-snug hover:text-accent transition-colors mb-2"
      >
        {article.title}
      </a>

      {article.summary && (
        <p className="text-sm text-muted leading-relaxed mb-3">{article.summary}</p>
      )}

      <div className="flex items-center justify-end gap-1">
        <button
          onClick={handleShare}
          className="p-1.5 rounded-md text-sm text-muted hover:text-foreground hover:bg-card-border/30 transition-colors"
          title="Copy link"
        >
          &#x1F517;
        </button>
        <button
          onClick={handleUnbookmark}
          className="p-1.5 rounded-md text-sm text-accent bg-accent-light hover:opacity-80 transition-opacity"
          title="Remove bookmark"
        >
          &#x1F516;
        </button>
      </div>
    </div>
  );
}
