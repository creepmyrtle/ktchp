'use client';

import { useState } from 'react';

interface CheckResult {
  valid: boolean;
  title: string | null;
  article_count: number;
  recent_count: number;
  newest_article_age: string | null;
  error: string | null;
  warnings: string[];
}

type FlowState = 'idle' | 'checking' | 'result' | 'adding' | 'added';

interface AddSourcePreCheckProps {
  onSourceAdded: () => void;
  atLimit?: boolean;
}

export default function AddSourcePreCheck({ onSourceAdded, atLimit = false }: AddSourcePreCheckProps) {
  const [state, setState] = useState<FlowState>('idle');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!feedUrl.trim()) return;

    setState('checking');
    setResult(null);

    try {
      const res = await fetch('/api/sources/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl.trim() }),
      });
      const data: CheckResult = await res.json();
      setResult(data);

      // Auto-fill name from detected title if user hasn't typed one
      if (data.title && !feedName.trim()) {
        setFeedName(data.title);
      }

      setState('result');
    } catch {
      setResult({
        valid: false,
        title: null,
        article_count: 0,
        recent_count: 0,
        newest_article_age: null,
        error: 'Network error — could not reach the server.',
        warnings: [],
      });
      setState('result');
    }
  }

  async function handleAdd() {
    setState('adding');

    let name = feedName.trim();
    if (!name) {
      try {
        const hostname = new URL(feedUrl).hostname.replace('www.', '').replace('feeds.', '');
        name = hostname.charAt(0).toUpperCase() + hostname.slice(1);
      } catch {
        name = feedUrl;
      }
    }

    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'rss', config: { url: feedUrl.trim() } }),
    });

    if (res.ok) {
      setState('added');
      onSourceAdded();
      // Reset after brief delay
      setTimeout(() => {
        setFeedUrl('');
        setFeedName('');
        setResult(null);
        setState('idle');
      }, 2000);
    } else {
      setState('result');
    }
  }

  function handleCancel() {
    setResult(null);
    setState('idle');
  }

  function handleRetry() {
    setResult(null);
    setState('idle');
  }

  const isDisabled = state === 'checking' || state === 'adding' || state === 'added' || atLimit;

  return (
    <div className="p-4 rounded-lg bg-card border border-card-border space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">Add RSS Feed</p>
        <button
          type="button"
          onClick={() => setHelpOpen(!helpOpen)}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          {helpOpen ? 'Hide help' : 'What is this?'}
        </button>
      </div>

      {helpOpen && (
        <div className="text-xs text-muted space-y-2 pb-2 border-b border-card-border mb-2">
          <p>
            <strong className="text-foreground">RSS feeds</strong> are how websites publish updates.
            Most news sites, blogs, and publications have one. ketchup checks your feeds
            periodically and scores new articles against your interests.
          </p>
          <p className="font-medium text-foreground">How to find a feed URL:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Look for an RSS or feed icon on the site (often in the footer or header).
            </li>
            <li>
              Try adding <code className="bg-card-border/50 px-1 rounded">/feed</code>,{' '}
              <code className="bg-card-border/50 px-1 rounded">/rss</code>, or{' '}
              <code className="bg-card-border/50 px-1 rounded">/feed.xml</code> to the site&apos;s URL.
            </li>
            <li>
              Search for <em>&quot;[site name] RSS feed&quot;</em> &mdash; most sites document theirs.
            </li>
            <li>
              For Reddit: add <code className="bg-card-border/50 px-1 rounded">/.rss</code> to any subreddit URL
              (e.g., <code className="bg-card-border/50 px-1 rounded">reddit.com/r/technology/.rss</code>).
            </li>
          </ul>
          <p className="font-medium text-foreground">Examples of feed URLs:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li><code className="bg-card-border/50 px-1 rounded">https://hnrss.org/frontpage</code> &mdash; Hacker News</li>
            <li><code className="bg-card-border/50 px-1 rounded">https://www.theverge.com/rss/index.xml</code> &mdash; The Verge</li>
            <li><code className="bg-card-border/50 px-1 rounded">https://feeds.arstechnica.com/arstechnica/index</code> &mdash; Ars Technica</li>
            <li><code className="bg-card-border/50 px-1 rounded">https://lobste.rs/rss</code> &mdash; Lobsters</li>
          </ul>
        </div>
      )}

      <form onSubmit={handleCheck}>
        <input
          type="url"
          value={feedUrl}
          onChange={e => setFeedUrl(e.target.value)}
          placeholder="Paste feed URL (e.g. https://example.com/feed.xml)"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          disabled={isDisabled}
        />

        {/* Name input + Check button (idle/checking states) */}
        {(state === 'idle' || state === 'checking') && (
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <input
              type="text"
              value={feedName}
              onChange={e => setFeedName(e.target.value)}
              placeholder="Name (optional — auto-detected from feed)"
              className="flex-1 px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
              disabled={isDisabled}
            />
            <button
              type="submit"
              disabled={!feedUrl.trim() || state === 'checking'}
              className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              {state === 'checking' ? 'Checking feed...' : 'Check Feed'}
            </button>
          </div>
        )}
      </form>

      {/* Result display */}
      {state === 'result' && result && (
        <div className="mt-2 space-y-2">
          {result.valid && result.warnings.length === 0 && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <span className="text-success shrink-0 mt-0.5">{'\u2713'}</span>
                <span>
                  Found {result.title ? `\u201C${result.title}\u201D` : 'feed'} — {result.article_count} article{result.article_count !== 1 ? 's' : ''}, {result.recent_count} from the last 14 days
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <input
                  type="text"
                  value={feedName}
                  onChange={e => setFeedName(e.target.value)}
                  placeholder="Name (optional)"
                  className="flex-1 px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 shrink-0"
                  >
                    Add Source
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 rounded border border-card-border text-muted text-sm hover:text-foreground shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}

          {result.valid && result.warnings.length > 0 && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <span className="text-serendipity shrink-0 mt-0.5">{'\u26A0'}</span>
                <span>
                  Found {result.title ? `\u201C${result.title}\u201D` : 'feed'} — {result.article_count} article{result.article_count !== 1 ? 's' : ''}, {result.recent_count} from the last 14 days
                </span>
              </div>
              <div className="text-xs text-muted space-y-1 pl-5">
                {result.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-1">
                <input
                  type="text"
                  value={feedName}
                  onChange={e => setFeedName(e.target.value)}
                  placeholder="Name (optional)"
                  className="flex-1 px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 shrink-0"
                  >
                    Add Anyway
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 rounded border border-card-border text-muted text-sm hover:text-foreground shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}

          {!result.valid && (
            <>
              <div className="flex items-start gap-2 text-sm">
                <span className="text-danger shrink-0 mt-0.5">{'\u2717'}</span>
                <span className="text-danger">{result.error || 'Could not validate this feed.'}</span>
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 shrink-0"
                >
                  Try Again
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded border border-card-border text-muted text-sm hover:text-foreground shrink-0"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Adding state */}
      {state === 'adding' && (
        <p className="text-sm text-muted mt-2">Adding source...</p>
      )}

      {/* Added confirmation */}
      {state === 'added' && (
        <div className="flex items-center gap-2 text-sm text-success mt-2">
          <span>{'\u2713'}</span>
          <span>Source added</span>
        </div>
      )}
    </div>
  );
}
