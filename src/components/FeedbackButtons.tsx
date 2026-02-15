'use client';

import { useState } from 'react';

interface FeedbackButtonsProps {
  articleId: string;
  initialFeedback: string[];
  onDismiss: () => void;
}

export default function FeedbackButtons({ articleId, initialFeedback, onDismiss }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<Set<string>>(new Set(initialFeedback));

  async function sendFeedback(action: string) {
    // Optimistic UI
    const newFeedback = new Set(feedback);
    if (newFeedback.has(action)) {
      newFeedback.delete(action);
    } else {
      newFeedback.add(action);
      // thumbs_up and thumbs_down are mutually exclusive
      if (action === 'thumbs_up') newFeedback.delete('thumbs_down');
      if (action === 'thumbs_down') newFeedback.delete('thumbs_up');
    }
    setFeedback(newFeedback);

    if (action === 'dismiss') {
      onDismiss();
    }

    // Background API call
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId, action }),
    });
  }

  const btnClass = (action: string) =>
    `p-1.5 rounded text-sm transition-colors ${
      feedback.has(action)
        ? 'bg-accent-light text-accent'
        : 'text-muted hover:text-foreground hover:bg-card-border/50'
    }`;

  return (
    <div className="flex gap-1">
      <button onClick={() => sendFeedback('thumbs_up')} className={btnClass('thumbs_up')} title="More like this">
        &#128077;
      </button>
      <button onClick={() => sendFeedback('thumbs_down')} className={btnClass('thumbs_down')} title="Less like this">
        &#128078;
      </button>
      <button onClick={() => sendFeedback('bookmark')} className={btnClass('bookmark')} title="Bookmark">
        &#128278;
      </button>
      <button onClick={() => sendFeedback('dismiss')} className={btnClass('dismiss')} title="Dismiss">
        &#10005;
      </button>
    </div>
  );
}
