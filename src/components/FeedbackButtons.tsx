'use client';

import { useState } from 'react';
import { useToast } from './Toast';
import type { Sentiment } from '@/types';

interface ActionBarProps {
  articleId: string;
  articleUrl: string;
  initialSentiment: Sentiment | null;
  initialIsBookmarked: boolean;
  reversed?: boolean;
  onArchive: () => void;
  onSentimentChange?: (sentiment: Sentiment | null) => void;
  /** When true, hides sentiment buttons and archive — shows only bookmark + share (for touch devices where swipe handles those) */
  hideDesktopControls?: boolean;
}

export default function ActionBar({
  articleId,
  articleUrl,
  initialSentiment,
  initialIsBookmarked,
  reversed = false,
  onArchive,
  onSentimentChange,
  hideDesktopControls = false,
}: ActionBarProps) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(initialSentiment);
  const [isBookmarked, setIsBookmarked] = useState(initialIsBookmarked);
  const { showToast } = useToast();

  function sendAction(action: string) {
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId, action }),
    }).catch(() => showToast('Action failed', 'error'));
  }

  function handleSentiment(value: Sentiment) {
    const newSentiment = sentiment === value ? null : value;
    setSentiment(newSentiment);
    onSentimentChange?.(newSentiment);
    sendAction(value);
  }

  function handleBookmark() {
    const willBookmark = !isBookmarked;
    setIsBookmarked(willBookmark);
    sendAction(willBookmark ? 'bookmark' : 'unbookmark');
  }

  function handleShare() {
    navigator.clipboard.writeText(articleUrl).then(
      () => showToast('Link copied!'),
      () => showToast('Failed to copy', 'error')
    );
  }

  const sentimentBtnClass = (value: Sentiment) => {
    const isActive = sentiment === value;
    const colors = {
      liked: isActive ? 'bg-success/15 text-success border-success/30' : '',
      skipped: isActive ? 'bg-muted/15 text-muted border-muted/30' : '',
    };
    return `p-1.5 sm:p-2 rounded-md text-sm border transition-all ${
      isActive
        ? colors[value]
        : 'border-transparent text-muted hover:text-foreground hover:bg-card-border/30'
    }`;
  };

  const iconBtnClass = (active: boolean) =>
    `p-1.5 sm:p-2 rounded-md text-sm transition-colors ${
      active
        ? 'text-accent bg-accent-light'
        : 'text-muted hover:text-foreground hover:bg-card-border/30'
    }`;

  const likeBtn = (
    <button onClick={() => handleSentiment('liked')} className={sentimentBtnClass('liked')} title="Like">
      &#x1F44D;
    </button>
  );
  const skipBtn = (
    <button onClick={() => handleSentiment('skipped')} className={sentimentBtnClass('skipped')} title="Skip">
      &#x2192;
    </button>
  );

  // On touch devices, only show bookmark + share (swipe handles sentiment + archive)
  if (hideDesktopControls) {
    return (
      <div className="flex items-center gap-0.5">
        <button onClick={handleBookmark} className={iconBtnClass(isBookmarked)} title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}>
          {isBookmarked ? '\uD83D\uDD16' : '\uD83D\uDCCC'}
        </button>
        <button onClick={handleShare} className={iconBtnClass(false)} title="Copy link">
          &#x1F517;
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
      {/* Sentiment group — order swaps when reversed */}
      <div className="flex items-center border border-card-border rounded-lg overflow-hidden">
        {reversed ? <>{skipBtn}{likeBtn}</> : <>{likeBtn}{skipBtn}</>}
      </div>

      {/* Bookmark */}
      <button onClick={handleBookmark} className={iconBtnClass(isBookmarked)} title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}>
        {isBookmarked ? '\uD83D\uDD16' : '\uD83D\uDCCC'}
      </button>

      {/* Share / copy link */}
      <button onClick={handleShare} className={iconBtnClass(false)} title="Copy link">
        &#x1F517;
      </button>

      {/* Archive */}
      <button onClick={onArchive} className={`${iconBtnClass(false)} hover:text-success hover:bg-success/10`} title="Archive">
        &#x1F4E5;
      </button>
    </div>
  );
}
