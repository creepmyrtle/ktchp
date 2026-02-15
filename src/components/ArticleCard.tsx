'use client';

import { useState } from 'react';
import type { ArticleWithSource } from '@/types';
import FeedbackButtons from './FeedbackButtons';

interface ArticleCardProps {
  article: ArticleWithSource;
  initialFeedback: string[];
}

export default function ArticleCard({ article, initialFeedback }: ArticleCardProps) {
  const [dismissed, setDismissed] = useState(initialFeedback.includes('dismiss'));

  if (dismissed) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-4 opacity-40 transition-opacity">
        <p className="text-sm text-muted">Dismissed</p>
      </div>
    );
  }

  const isSerendipity = !!article.is_serendipity;

  function timeAgo(dateStr: string | Date | null): string {
    if (!dateStr) return '';
    const str = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
    const utcDate = str.endsWith('Z') ? str : str + 'Z';
    const diff = Date.now() - new Date(utcDate).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div
      className={`rounded-lg border p-4 bg-card transition-all ${
        isSerendipity
          ? 'border-serendipity/40 shadow-sm'
          : 'border-card-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs text-muted">{article.source_name}</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            isSerendipity
              ? 'bg-serendipity-light text-serendipity'
              : 'bg-accent-light text-accent'
          }`}
        >
          {isSerendipity && '\u2728 '}
          {article.relevance_reason || 'Relevant'}
        </span>
      </div>

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium leading-snug hover:text-accent transition-colors mb-2"
        onClick={() => {
          fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articleId: article.id, action: 'click' }),
          });
        }}
      >
        {article.title}
      </a>

      {article.summary && (
        <p className="text-sm text-muted leading-relaxed mb-3">
          {article.summary}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {timeAgo(article.published_at)}
        </span>
        <FeedbackButtons
          articleId={article.id}
          initialFeedback={initialFeedback}
          onDismiss={() => setDismissed(true)}
        />
      </div>
    </div>
  );
}
