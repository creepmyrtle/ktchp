'use client';

import { useState, useEffect } from 'react';

export default function SwipeSettings() {
  const [direction, setDirection] = useState<'right' | 'left'>('right');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings/swipe')
      .then(r => r.json())
      .then(data => {
        setDirection(data.direction || 'right');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function update(value: 'right' | 'left') {
    setDirection(value);
    await fetch('/api/settings/swipe', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: value }),
    });
  }

  if (loading) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Configure touch gestures for the digest view on mobile devices.
      </p>

      <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm text-foreground font-medium">Swipe to archive direction</p>
        <div className="flex rounded-md border border-card-border overflow-hidden w-fit">
          <button
            onClick={() => update('right')}
            className={`px-4 py-2 text-sm transition-colors ${
              direction === 'right'
                ? 'bg-accent-light text-accent'
                : 'bg-card text-muted hover:text-foreground'
            }`}
          >
            Right &rarr;
          </button>
          <button
            onClick={() => update('left')}
            className={`px-4 py-2 text-sm transition-colors ${
              direction === 'left'
                ? 'bg-accent-light text-accent'
                : 'bg-card text-muted hover:text-foreground'
            }`}
          >
            &larr; Left
          </button>
        </div>
        <p className="text-xs text-muted">
          Swipe articles in this direction to archive them. Only works on touch devices.
        </p>
      </div>
    </div>
  );
}
