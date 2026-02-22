'use client';

import { useState, useEffect, useCallback } from 'react';
import SourceTrustIndicator from './SourceTrustIndicator';
import SourceHealthIndicator from './SourceHealthIndicator';
import SourcePageHeader from './SourcePageHeader';
import AddSourcePreCheck from './AddSourcePreCheck';

interface Source {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  is_default?: boolean;
  created_at: string;
  last_fetch_error?: string | null;
  last_fetched_at?: string | null;
  last_fetch_status?: string | null;
  last_new_article_at?: string | null;
  consecutive_errors?: number;
  articles_14d?: number;
  health_status?: string;
}

interface TrustData {
  source_id: string;
  trust_factor: number;
  sample_size: number;
}

interface OpmlFeed {
  name: string;
  url: string;
}

function parseOpml(xml: string): OpmlFeed[] {
  // Sanitize unescaped & characters that break XML parsing (common in OPML exports)
  const sanitized = xml.replace(/&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'text/xml');

  // Check for XML parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML');
  }

  const feeds: OpmlFeed[] = [];

  const outlines = doc.querySelectorAll('outline[xmlUrl]');
  for (const outline of outlines) {
    const rawUrl = outline.getAttribute('xmlUrl');
    const name = outline.getAttribute('title') || outline.getAttribute('text') || '';
    if (rawUrl) {
      const url = rawUrl.trim();
      // Validate URL
      try {
        new URL(url);
        feeds.push({ name: name.trim(), url });
      } catch {
        // Skip invalid URLs silently during parse — they'll never work as feeds
      }
    }
  }

  return feeds;
}

interface SourceLimits {
  private_sources: { current: number; max: number };
}

export default function SourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [trustMap, setTrustMap] = useState<Map<string, TrustData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importHadAdds, setImportHadAdds] = useState(false);
  const [limits, setLimits] = useState<SourceLimits | null>(null);

  const fetchSources = useCallback(async () => {
    const res = await fetch('/api/sources');
    if (res.ok) {
      setSources(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/limits')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setLimits(data); })
      .catch(() => {});
  }, [sources]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  useEffect(() => {
    fetch('/api/sources/trust')
      .then(res => res.ok ? res.json() : [])
      .then((data: TrustData[]) => {
        const map = new Map<string, TrustData>();
        for (const t of data) map.set(t.source_id, t);
        setTrustMap(map);
      })
      .catch(() => {});
  }, []);

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

  const [importResults, setImportResults] = useState<Array<{ name: string; url: string; status: 'added' | 'duplicate' | 'failed'; error?: string }>>([]);

  async function handleOpmlImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportStatus(null);
    setImportResults([]);
    setImportHadAdds(false);

    try {
      const text = await file.text();
      const feeds = parseOpml(text);

      if (feeds.length === 0) {
        setImportStatus('No feeds found in file.');
        setImporting(false);
        return;
      }

      setImportStatus(`Found ${feeds.length} feed${feeds.length !== 1 ? 's' : ''} in file. Importing...`);

      const existingUrls = new Set(sources.map(s => (s.config.url as string)?.toLowerCase()));
      const results: typeof importResults = [];

      for (let i = 0; i < feeds.length; i++) {
        const feed = feeds[i];
        setImportStatus(`Processing ${i + 1} of ${feeds.length}: ${feed.name || feed.url}`);

        if (existingUrls.has(feed.url.toLowerCase())) {
          results.push({ name: feed.name, url: feed.url, status: 'duplicate' });
          continue;
        }

        try {
          const res = await fetch('/api/sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: feed.name, type: 'rss', config: { url: feed.url } }),
          });
          if (res.ok) {
            results.push({ name: feed.name, url: feed.url, status: 'added' });
            existingUrls.add(feed.url.toLowerCase());
          } else {
            const body = await res.json().catch(() => ({}));
            results.push({ name: feed.name, url: feed.url, status: 'failed', error: body.error || `HTTP ${res.status}` });
          }
        } catch (err) {
          results.push({ name: feed.name, url: feed.url, status: 'failed', error: String(err) });
        }
      }

      setImportResults(results);

      const added = results.filter(r => r.status === 'added').length;
      const dupes = results.filter(r => r.status === 'duplicate').length;
      const failed = results.filter(r => r.status === 'failed').length;

      const parts = [`${feeds.length} feeds found`];
      if (added > 0) parts.push(`${added} added`);
      if (dupes > 0) parts.push(`${dupes} already existed`);
      if (failed > 0) parts.push(`${failed} failed`);
      setImportStatus(parts.join(' \u2022 '));

      if (added > 0) {
        setImportHadAdds(true);
        fetchSources();
      }
    } catch {
      setImportStatus('Failed to parse file. Make sure it\'s a valid OPML/XML file.');
    }

    setImporting(false);
    e.target.value = '';
  }

  const atLimit = limits ? limits.private_sources.current >= limits.private_sources.max : false;

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <SourcePageHeader />

      <AddSourcePreCheck onSourceAdded={fetchSources} atLimit={atLimit} />

      {atLimit && limits && (
        <p className="text-xs text-yellow-400 -mt-2">
          Private source limit reached ({limits.private_sources.current}/{limits.private_sources.max}). Remove or disable a source to add a new one.
        </p>
      )}

      <div className="p-4 rounded-lg bg-card border border-card-border space-y-2">
        <p className="text-sm font-medium">Import from OPML</p>
        <p className="text-xs text-muted">
          Import feeds from an OPML file exported from another RSS reader (e.g., Feedly, Inoreader, NetNewsWire).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`px-4 py-2 rounded text-sm shrink-0 cursor-pointer transition-opacity ${
            importing ? 'bg-accent/50 text-white opacity-50 pointer-events-none' : 'bg-accent text-white hover:opacity-90'
          }`}>
            {importing ? 'Importing...' : 'Choose OPML File'}
            <input
              type="file"
              accept=".opml,.xml,.txt"
              onChange={handleOpmlImport}
              disabled={importing}
              className="hidden"
            />
          </label>
          {importStatus && (
            <p className="text-xs text-muted">{importStatus}</p>
          )}
        </div>

        {importResults.length > 0 && !importing && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {importResults.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`shrink-0 mt-0.5 ${
                  r.status === 'added' ? 'text-green-400' : r.status === 'duplicate' ? 'text-muted' : 'text-red-400'
                }`}>
                  {r.status === 'added' ? '\u2713' : r.status === 'duplicate' ? '\u2013' : '\u2717'}
                </span>
                <div className="min-w-0">
                  <span className="text-foreground">{r.name || r.url}</span>
                  {r.status === 'duplicate' && <span className="text-muted ml-1">(already exists)</span>}
                  {r.status === 'failed' && <span className="text-red-400 ml-1">({r.error})</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {importHadAdds && !importing && (
          <p className="text-xs text-muted mt-2">
            New sources will show their health status after the next ingestion cycle.
          </p>
        )}
      </div>

      {sources.filter(s => s.enabled).length > 0 && (
        <div>
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">Active Sources</p>
          {sources.filter(s => s.enabled).map(source => {
            const trust = trustMap.get(source.id);
            return (
            <div key={source.id} className="p-3 rounded-lg bg-card border border-card-border mb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{source.name}</p>
                    {trust && <SourceTrustIndicator trustFactor={trust.trust_factor} sampleSize={trust.sample_size} />}
                  </div>
                  <p className="text-xs text-muted truncate">{(source.config.url as string) || source.type}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleSource(source.id, source.enabled)}
                    className="text-xs px-2 py-1 rounded bg-accent-light text-accent"
                  >
                    Disable
                  </button>
                  {source.is_default ? (
                    <span className="text-xs text-muted">Default</span>
                  ) : (
                    <button
                      onClick={() => deleteSource(source.id)}
                      className="text-xs text-danger hover:opacity-80"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {source.health_status && (
                <SourceHealthIndicator
                  healthStatus={source.health_status}
                  articles14d={source.articles_14d}
                  lastNewArticleAt={source.last_new_article_at}
                  lastFetchError={source.last_fetch_error}
                  lastFetchStatus={source.last_fetch_status}
                  consecutiveErrors={source.consecutive_errors}
                  createdAt={source.created_at}
                />
              )}
            </div>
            );
          })}
        </div>
      )}

      {sources.filter(s => !s.enabled).length > 0 && (
        <div>
          <p className="text-xs text-muted mb-2 uppercase tracking-wide">Disabled Sources</p>
          {sources.filter(s => !s.enabled).map(source => (
            <div key={source.id} className="p-3 rounded-lg bg-card border border-card-border mb-2 opacity-60">
              <div className="flex items-start justify-between gap-2">
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
                  {source.is_default ? (
                    <span className="text-xs text-muted">Default</span>
                  ) : (
                    <button
                      onClick={() => deleteSource(source.id)}
                      className="text-xs text-danger hover:opacity-80"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {source.health_status && (
                <SourceHealthIndicator
                  healthStatus={source.health_status}
                  articles14d={source.articles_14d}
                  lastNewArticleAt={source.last_new_article_at}
                  lastFetchError={source.last_fetch_error}
                  lastFetchStatus={source.last_fetch_status}
                  consecutiveErrors={source.consecutive_errors}
                  createdAt={source.created_at}
                />
              )}
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
