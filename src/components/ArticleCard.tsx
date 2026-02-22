'use client';

import { useState, useRef, useCallback } from 'react';
import type { UserArticleWithSource, Sentiment, DigestTier } from '@/types';
import ActionBar from './FeedbackButtons';
import { useSwipeToArchive, SWIPE_ZONE_PX } from '@/hooks/useSwipeToArchive';
import { timeAgo } from '@/lib/utils/time';

interface ArticleCardProps {
  article: UserArticleWithSource;
  swipeDirection?: 'right' | 'left';
  tier?: DigestTier;
  onArchived?: () => void;
}

export default function ArticleCard({ article, swipeDirection = 'right', tier, onArchived }: ArticleCardProps) {
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment | null>(article.sentiment);
  const [isRead, setIsRead] = useState(article.is_read);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isSerendipity = !!article.is_serendipity;
  const isBonus = tier === 'bonus';

  const handleArchive = useCallback(() => {
    // Persist to DB
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: 'archived' }),
    });

    const wrapper = wrapperRef.current;
    const savedScrollY = window.scrollY;

    // Pin wrapper height in a rAF to batch the read/write and avoid DOM thrashing
    requestAnimationFrame(() => {
      if (wrapper) {
        wrapper.style.height = `${wrapper.offsetHeight}px`;
      }

      setArchiving(true);

      // After opacity fade (300ms), collapse the space
      setTimeout(() => {
        if (wrapper) {
          wrapper.style.transition = 'height 300ms ease-out';
          wrapper.style.height = '0px';
          wrapper.style.overflow = 'hidden';
          // After collapse, remove from layout and notify parent
          setTimeout(() => {
            if (wrapper) wrapper.style.display = 'none';
            if (window.scrollY !== savedScrollY) {
              window.scrollTo(0, savedScrollY);
            }
            setArchived(true);
            onArchived?.();
          }, 300);
        }
      }, 300);
    });
  }, [article.article_id, onArchived]);

  function handleSwipeBlocked() {
    // Shake the sentiment buttons — handled by ActionBar's pulse
  }

  const { scrollRef, indicatorRef } = useSwipeToArchive({
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
      body: JSON.stringify({ articleId: article.article_id, action: 'read' }),
    });
  }

  const indicatorEl = (
    <div
      ref={indicatorRef}
      className={`flex-shrink-0 flex items-center rounded-lg opacity-0 ${
        swipeDirection === 'right' ? 'justify-end pr-6' : 'justify-start pl-6'
      } ${sentiment ? 'bg-success/20' : 'bg-serendipity/20'}`}
      style={{ width: `${SWIPE_ZONE_PX}px` }}
    >
      <span className="text-xl">{sentiment ? '\u2713' : '\u26A0'}</span>
    </div>
  );

  const cardEl = (
    <div
      className={`flex-shrink-0 w-full rounded-lg border p-4 bg-card card-hover ${
        swipeDirection === 'left' ? 'snap-start' : 'snap-start'
      } ${
        isBonus
          ? 'border-slate-500/40'
          : isSerendipity
            ? 'border-serendipity/40 card-hover-serendipity'
            : sentiment
              ? 'border-card-border/60'
              : 'border-card-border'
      }`}
    >
      {/* Header: source + relevance tag */}
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <span className="text-xs text-muted flex items-center gap-1.5">
          {!isRead && <span className={`inline-block w-1.5 h-1.5 rounded-full ${isBonus ? 'bg-slate-400' : 'bg-accent'}`} />}
          {article.source_name}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full leading-tight ${
            isBonus
              ? 'bg-slate-500/15 text-slate-400'
              : isSerendipity
                ? 'bg-serendipity-light text-serendipity'
                : 'bg-accent-light text-accent'
          }`}
        >
          {isSerendipity && '\u2728 '}
          {isBonus ? 'Below threshold' : (article.relevance_reason || 'Relevant')}
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
          articleId={article.article_id}
          articleUrl={article.url}
          initialSentiment={article.sentiment}
          initialIsBookmarked={article.is_bookmarked}
          swipeDirection={swipeDirection}
          onArchive={handleArchive}
          onSentimentChange={(s) => setSentiment(s)}
        />
      </div>
    </div>
  );

  return (
    <div ref={wrapperRef}>
      {!archived && (
        <div className={archiving ? 'card-archiving' : ''}>
          <div
            ref={scrollRef}
            className={`flex snap-x snap-mandatory swipe-scroll ${
              !archiving && !archived ? 'overflow-x-auto' : 'overflow-x-hidden'
            }`}
          >
            {swipeDirection === 'right' && indicatorEl}
            {cardEl}
            {swipeDirection === 'left' && indicatorEl}
          </div>
        </div>
      )}
    </div>
  );
}
