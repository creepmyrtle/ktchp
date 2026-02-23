'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { UserArticleWithSource, Sentiment, DigestTier } from '@/types';
import ActionBar from './FeedbackButtons';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useToast } from './Toast';
import { timeAgo } from '@/lib/utils/time';

interface ArticleCardProps {
  article: UserArticleWithSource;
  reversed?: boolean;
  tier?: DigestTier;
  onArchived?: () => void;
  onUnarchived?: () => void;
}

export default function ArticleCard({ article, reversed = false, tier, onArchived, onUnarchived }: ArticleCardProps) {
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment | null>(article.sentiment);
  const [isRead, setIsRead] = useState(article.is_read);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const isSerendipity = !!article.is_serendipity;
  const isBonus = tier === 'bonus';

  // Detect touch device on first touchstart
  useEffect(() => {
    function onTouch() {
      setIsTouchDevice(true);
      window.removeEventListener('touchstart', onTouch);
    }
    window.addEventListener('touchstart', onTouch, { passive: true });
    return () => window.removeEventListener('touchstart', onTouch);
  }, []);

  const collapseAndArchive = useCallback((toastMessage?: string, toastSentiment?: Sentiment | null) => {
    const wrapper = wrapperRef.current;
    const savedScrollY = window.scrollY;

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
          setTimeout(() => {
            if (wrapper) wrapper.style.display = 'none';
            if (window.scrollY !== savedScrollY) {
              window.scrollTo(0, savedScrollY);
            }
            setArchived(true);
            onArchived?.();

            // Show undo toast
            if (toastMessage) {
              showToast(toastMessage, 'success', {
                label: 'Undo',
                onClick: () => handleUndo(toastSentiment ?? null),
              });
            }
          }, 300);
        }
      }, 300);
    });
  }, [onArchived, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUndo = useCallback((prevSentiment: Sentiment | null) => {
    // Fire unarchive API
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: 'unarchived' }),
    });

    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.style.display = '';
      wrapper.style.transition = 'height 300ms ease-out';
      wrapper.style.height = '';
      wrapper.style.overflow = '';
    }

    setArchived(false);
    setArchiving(false);
    setSentiment(prevSentiment);
    onUnarchived?.();
  }, [article.article_id, onUnarchived]);

  // Desktop archive handler (from button)
  const handleArchive = useCallback(() => {
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: 'archived' }),
    });
    collapseAndArchive();
  }, [article.article_id, collapseAndArchive]);

  // Swipe commit handler
  const handleSwipeCommit = useCallback((direction: 'left' | 'right') => {
    // Determine sentiment based on direction and reversed setting
    let swipeSentiment: Sentiment;
    if (reversed) {
      swipeSentiment = direction === 'left' ? 'liked' : 'skipped';
    } else {
      swipeSentiment = direction === 'right' ? 'liked' : 'skipped';
    }

    setSentiment(swipeSentiment);

    // Fire-and-forget: sentiment + archive
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: swipeSentiment }),
    });
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId: article.article_id, action: 'archived' }),
    });

    const label = swipeSentiment === 'liked' ? 'Liked + archived' : 'Skipped + archived';
    collapseAndArchive(label, swipeSentiment);
  }, [article.article_id, reversed, collapseAndArchive]);

  const { cardRef, style: swipeStyle, isSwiping, swipeDirection, progress } = useSwipeGesture({
    onSwipeCommit: handleSwipeCommit,
    reversed,
    enabled: !archiving && !archived && isTouchDevice,
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

  // Determine swipe background colors based on direction
  const getSwipeBgColor = (side: 'left' | 'right') => {
    const isLikeSide = reversed ? side === 'left' : side === 'right';
    return isLikeSide ? 'bg-success/20' : 'bg-muted/15';
  };

  const getSwipeIcon = (side: 'left' | 'right') => {
    const isLikeSide = reversed ? side === 'left' : side === 'right';
    return isLikeSide ? '\uD83D\uDC4D' : '\u2192';
  };

  return (
    <div ref={wrapperRef}>
      {!archived && (
        <div className={archiving ? 'card-archiving' : ''}>
          <div className="relative overflow-hidden rounded-lg">
            {/* Swipe background — revealed as card slides */}
            {isTouchDevice && isSwiping && (
              <div className="absolute inset-0 flex">
                <div className={`flex-1 flex items-center justify-center ${getSwipeBgColor('left')} rounded-l-lg`}
                  style={{ opacity: swipeDirection === 'left' ? progress : 0 }}>
                  <span className="text-xl">{getSwipeIcon('left')}</span>
                </div>
                <div className={`flex-1 flex items-center justify-center ${getSwipeBgColor('right')} rounded-r-lg`}
                  style={{ opacity: swipeDirection === 'right' ? progress : 0 }}>
                  <span className="text-xl">{getSwipeIcon('right')}</span>
                </div>
              </div>
            )}

            {/* The card — moves with touch */}
            <div ref={cardRef} style={swipeStyle}
              className={`rounded-lg border p-4 bg-card card-hover relative ${
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
                {/* On touch devices: hide sentiment/archive buttons, show only bookmark+share.
                    On desktop: show full button layout */}
                {isTouchDevice ? (
                  <div className="flex items-center gap-0.5">
                    <ActionBar
                      articleId={article.article_id}
                      articleUrl={article.url}
                      initialSentiment={article.sentiment}
                      initialIsBookmarked={article.is_bookmarked}
                      reversed={reversed}
                      onArchive={handleArchive}
                      onSentimentChange={(s) => setSentiment(s)}
                      hideDesktopControls
                    />
                  </div>
                ) : (
                  <ActionBar
                    articleId={article.article_id}
                    articleUrl={article.url}
                    initialSentiment={article.sentiment}
                    initialIsBookmarked={article.is_bookmarked}
                    reversed={reversed}
                    onArchive={handleArchive}
                    onSentimentChange={(s) => setSentiment(s)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
