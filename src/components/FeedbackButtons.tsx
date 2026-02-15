'use client';

import { useState } from 'react';
import { useToast } from './Toast';
import type { Sentiment } from '@/types';

interface ActionBarProps {
  articleId: string;
  articleUrl: string;
  initialSentiment: Sentiment | null;
  initialIsBookmarked: boolean;
  onArchive: () => void;
  onSentimentChange?: (sentiment: Sentiment | null) => void;
}

export default function ActionBar({
  articleId,
  articleUrl,
  initialSentiment,
  initialIsBookmarked,
  onArchive,
  onSentimentChange,
}: ActionBarProps) {
  const [sentiment, setSentiment] = useState<Sentiment | null>(initialSentiment);
  const [isBookmarked, setIsBookmarked] = useState(initialIsBookmarked);
  const [sentimentPulse, setSentimentPulse] = useState(false);
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

  function handleArchive() {
    if (!sentiment) {
      setSentimentPulse(true);
      setTimeout(() => setSentimentPulse(false), 600);
      showToast('Rate this article first', 'error');
      return;
    }
    sendAction('archived');
    onArchive();
  }

  const sentimentBtnClass = (value: Sentiment) => {
    const isActive = sentiment === value;
    const colors = {
      liked: isActive ? 'bg-success/15 text-success border-success/30' : '',
      neutral: isActive ? 'bg-muted/15 text-muted border-muted/30' : '',
      disliked: isActive ? 'bg-danger/15 text-danger border-danger/30' : '',
    };
    return `p-1.5 sm:p-2 rounded-md text-sm border transition-all ${
      isActive
        ? colors[value]
        : 'border-transparent text-muted hover:text-foreground hover:bg-card-border/30'
    } ${sentimentPulse && !sentiment ? 'animate-pulse' : ''}`;
  };

  const iconBtnClass = (active: boolean) =>
    `p-1.5 sm:p-2 rounded-md text-sm transition-colors ${
      active
        ? 'text-accent bg-accent-light'
        : 'text-muted hover:text-foreground hover:bg-card-border/30'
    }`;

  return (
    <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
      {/* Sentiment group */}
      <div className="flex items-center border border-card-border rounded-lg overflow-hidden">
        <button onClick={() => handleSentiment('liked')} className={sentimentBtnClass('liked')} title="Liked">
          &#x1F44D;
        </button>
        <button onClick={() => handleSentiment('neutral')} className={sentimentBtnClass('neutral')} title="Neutral">
          &#x2796;
        </button>
        <button onClick={() => handleSentiment('disliked')} className={sentimentBtnClass('disliked')} title="Disliked">
          &#x1F44E;
        </button>
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
      <button onClick={handleArchive} className={`${iconBtnClass(false)} ${sentiment ? 'hover:text-success hover:bg-success/10' : ''}`} title="Archive">
        &#x2705;
      </button>
    </div>
  );
}
