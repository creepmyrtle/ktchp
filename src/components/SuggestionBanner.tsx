'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function SuggestionBanner() {
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/suggestions')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCount(data.length);
      })
      .catch(() => {});
  }, []);

  if (count === 0 || dismissed) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-card border border-card-border flex items-center justify-between gap-2">
      <p className="text-xs text-muted">
        ketchup noticed you might be interested in{' '}
        <span className="text-foreground">{count} new topic{count !== 1 ? 's' : ''}</span>.{' '}
        <Link href="/settings" className="text-accent hover:opacity-80">
          Review in Settings
        </Link>
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted hover:text-foreground text-sm shrink-0"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
