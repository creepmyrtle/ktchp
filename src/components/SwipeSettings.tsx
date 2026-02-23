'use client';

import { useState, useEffect } from 'react';

export default function SwipeSettings() {
  const [reversed, setReversed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings/swipe')
      .then(r => r.json())
      .then(data => {
        setReversed(data.reversed === true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function toggle() {
    const newValue = !reversed;
    setReversed(newValue);
    await fetch('/api/settings/swipe', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reversed: newValue }),
    });
  }

  if (loading) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Configure swipe gestures for the digest view on mobile devices.
      </p>

      <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground font-medium">Reverse swipe directions</p>
            <p className="text-xs text-muted mt-1">
              {reversed
                ? 'Swipe left to like, right to skip'
                : 'Swipe right to like, left to skip'}
            </p>
          </div>
          <button
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              reversed ? 'bg-accent' : 'bg-card-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-foreground transition-transform ${
                reversed ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
