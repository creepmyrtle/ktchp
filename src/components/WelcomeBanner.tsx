'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'ktchp_onboarding_dismissed';

export default function WelcomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="rounded-lg border border-accent/30 bg-accent-light/30 p-5 mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Welcome to ktchp</p>
          <ul className="text-sm text-muted space-y-1.5">
            <li>
              Add your <Link href="/settings" className="text-accent hover:opacity-80">interests</Link> so
              ktchp knows what to look for.
            </li>
            <li>
              Add <Link href="/settings" className="text-accent hover:opacity-80">RSS sources</Link> (or
              import an OPML file) to pull articles from.
            </li>
            <li>
              New digests are generated daily at <strong className="text-foreground">5 AM CT</strong>.
              Rate articles to improve future recommendations.
            </li>
          </ul>
        </div>
        <button
          onClick={dismiss}
          className="text-muted hover:text-foreground transition-colors shrink-0 text-lg leading-none"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
