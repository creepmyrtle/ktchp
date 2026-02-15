'use client';

import { useState } from 'react';
import type { ArticleWithSource, Sentiment } from '@/types';
import ActionBar from './FeedbackButtons';
import { useSwipeToArchive } from '@/hooks/useSwipeToArchive';

interface ArticleCardProps {
  article: ArticleWithSource;
  swipeDirection?: 'right' | 'left';
}

export default function ArticleCard({ article, swipeDirection = 'right' }: ArticleCardProps) {
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment | null>(article.sentiment);
  const [isRead, setIsRead] = useState(article.is_read);

  const isSerendipity = !!article.is_serendipity;

  function handleArchive() {
    setArchiving(true);
    // After animation, fully remove
    setTimeout(() => setArchived(true), 400);
  }

  function handleSwipeBlocked() {
    // Shake the sentiment buttons — handled by ActionBar's pulse
  }

  const { ref: swipeRef, bgRef, handlers } = useSwipeToArchive({
    onArchive: handleArchive,
    canArchive: !!sentiment,
    onSwipeBlocked: handleSwipeBlocked,
    direction: swipeDirection,
    enabled: !archiving && !archived,
  });

  // Auto-track read on link click
  function handleLinkClick() {
    setIsRead(true);
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.id, action: 'read' }),
    });
  }

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

  if (archived) return null;

  return (
    <div className={`relative ${archiving ? 'card-archiving' : ''}`}>
      {/* Swipe background indicator */}
      <div
        ref={bgRef}
        className={`absolute inset-0 rounded-lg flex items-center opacity-0 transition-opacity ${
          swipeDirection === 'right' ? 'justify-start pl-6' : 'justify-end pr-6'
        } ${sentiment ? 'bg-success/20' : 'bg-serendipity/20'}`}
      >
        <span className="text-xl">{sentiment ? '\u2713' : '\u26A0'}</span>
      </div>

      {/* Card content — swipeable */}
      <div
        ref={swipeRef}
        {...handlers}
        className={`relative rounded-lg border p-4 bg-card card-hover ${
          isSerendipity
            ? 'border-serendipity/40 card-hover-serendipity'
            : sentiment
              ? 'border-card-border/60'
              : 'border-card-border'
        }`}
      >
        {/* Header: source + relevance tag */}
        <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
          <span className="text-xs text-muted flex items-center gap-1.5">
            {!isRead && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />}
            {article.source_name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full leading-tight ${
              isSerendipity
                ? 'bg-serendipity-light text-serendipity'
                : 'bg-accent-light text-accent'
            }`}
          >
            {isSerendipity && '\u2728 '}
            {article.relevance_reason || 'Relevant'}
          </span>
        </div>

        {/* Title — clickable, marks as read */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block text-base font-medium leading-snug hover:text-accent transition-colors mb-2 ${isRead ? 'text-muted' : ''}`}
          onClick={handleLinkClick}
        >
          {article.title}
        </a>

        {/* AI Summary */}
        {article.summary && (
          <p className="text-sm text-muted leading-relaxed mb-3">
            {article.summary}
          </p>
        )}

        {/* Metadata + action bar */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-muted">
            {timeAgo(article.published_at)}
          </span>
          <ActionBar
            articleId={article.id}
            articleUrl={article.url}
            initialSentiment={article.sentiment}
            initialIsBookmarked={article.is_bookmarked}
            onArchive={handleArchive}
            onSentimentChange={(s) => setSentiment(s)}
          />
        </div>
      </div>
    </div>
  );
}
