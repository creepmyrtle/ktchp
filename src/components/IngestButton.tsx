'use client';

import { useState } from 'react';

export default function IngestButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string>('');
  const [clearing, setClearing] = useState(false);

  async function triggerIngest() {
    setStatus('loading');
    setResult('');

    try {
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        const ing = data.ingestion;
        setResult(
          `Fetched ${ing.totalFetched} articles, ${ing.newArticles} new.` +
          (data.digest ? ` Digest created with ${data.digest.digestArticleCount} articles.` : ' No digest generated (try again once scoring completes).')
        );
        setStatus('done');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult(data.error || 'Ingestion failed');
        setStatus('error');
      }
    } catch {
      setResult('Something went wrong');
      setStatus('error');
    }
  }

  async function clearDigest() {
    if (!window.confirm('Clear all articles and digests for the current provider? This cannot be undone.')) {
      return;
    }
    setClearing(true);
    try {
      const res = await fetch('/api/digests/clear', { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      setClearing(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
        <button
          onClick={triggerIngest}
          disabled={status === 'loading'}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {status === 'loading' ? 'Ingesting...' : 'Ingest Now'}
        </button>
        <button
          onClick={clearDigest}
          disabled={clearing || status === 'loading'}
          className="px-4 py-2.5 rounded-lg border border-card-border text-sm text-muted hover:text-danger hover:border-danger transition-colors disabled:opacity-50"
        >
          {clearing ? 'Clearing...' : 'Clear Provider'}
        </button>
      </div>
      {result && (
        <p className={`text-sm text-center max-w-md ${status === 'error' ? 'text-danger' : 'text-muted'}`}>
          {result}
        </p>
      )}
    </div>
  );
}
