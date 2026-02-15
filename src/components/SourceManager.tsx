'use client';

import { useState, useEffect, useCallback } from 'react';

interface Source {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export default function SourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedName, setFeedName] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchSources = useCallback(async () => {
    const res = await fetch('/api/sources');
    if (res.ok) {
      setSources(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  async function addFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!feedUrl.trim()) return;
    setAdding(true);

    // Auto-generate name from URL if not provided
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
      body: JSON.stringify({ name, type: 'rss', config: { url: feedUrl } }),
    });

    if (res.ok) {
      setFeedUrl('');
      setFeedName('');
      fetchSources();
    }
    setAdding(false);
  }

  async function toggleSource(id: string, enabled: boolean) {
    await fetch(`/api/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    });
    fetchSources();
  }

  async function deleteSource(id: string) {
    await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    fetchSources();
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <form onSubmit={addFeed} className="p-4 rounded-lg bg-card border border-card-border space-y-2">
        <p className="text-sm font-medium mb-1">Add RSS Feed</p>
        <input
          type="url"
          value={feedUrl}
          onChange={e => setFeedUrl(e.target.value)}
          placeholder="Paste feed URL (e.g. https://example.com/feed.xml)"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          autoFocus
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={feedName}
            onChange={e => setFeedName(e.target.value)}
            placeholder="Name (optional — auto-detected from URL)"
            className="flex-1 px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          />
          <button
            type="submit"
            disabled={!feedUrl.trim() || adding}
            className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {sources.filter(s => s.enabled).length > 0 && (
        <div>
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">Active Sources</p>
          {sources.filter(s => s.enabled).map(source => (
            <div key={source.id} className="p-3 rounded-lg bg-card border border-card-border mb-2 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{source.name}</p>
                <p className="text-xs text-muted truncate">{(source.config.url as string) || source.type}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleSource(source.id, source.enabled)}
                  className="text-xs px-2 py-1 rounded bg-accent-light text-accent"
                >
                  Disable
                </button>
                <button
                  onClick={() => deleteSource(source.id)}
                  className="text-xs text-danger hover:opacity-80"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sources.filter(s => !s.enabled).length > 0 && (
        <div>
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">Disabled Sources</p>
          {sources.filter(s => !s.enabled).map(source => (
            <div key={source.id} className="p-3 rounded-lg bg-card border border-card-border mb-2 flex items-center justify-between gap-2 opacity-60">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{source.name}</p>
                <p className="text-xs text-muted truncate">{(source.config.url as string) || source.type}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleSource(source.id, source.enabled)}
                  className="text-xs px-2 py-1 rounded bg-card-border text-muted"
                >
                  Enable
                </button>
                <button
                  onClick={() => deleteSource(source.id)}
                  className="text-xs text-danger hover:opacity-80"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sources.length === 0 && (
        <p className="text-muted text-sm text-center py-4">No sources yet. Add an RSS feed above.</p>
      )}
    </div>
  );
}
