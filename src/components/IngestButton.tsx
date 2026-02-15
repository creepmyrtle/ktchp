'use client';

import { useState } from 'react';

export default function IngestButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string>('');
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

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <button
        onClick={triggerIngest}
        disabled={status === 'loading'}
        className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {status === 'loading' ? 'Ingesting...' : 'Ingest Now'}
      </button>
      {result && (
        <p className={`text-sm text-center max-w-md ${status === 'error' ? 'text-danger' : 'text-muted'}`}>
          {result}
        </p>
      )}
    </div>
  );
}
