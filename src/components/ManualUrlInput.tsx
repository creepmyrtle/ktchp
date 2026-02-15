'use client';

import { useState } from 'react';

export default function ManualUrlInput() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setStatus('loading');
    try {
      const res = await fetch('/api/manual-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (res.ok) {
        setStatus('success');
        setMessage('URL queued for next digest');
        setUrl('');
      } else {
        const data = await res.json();
        setStatus('error');
        setMessage(data.error || 'Failed to queue URL');
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong');
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Paste a URL to include in your next digest. The article will be fetched and scored alongside your regular sources.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setStatus('idle'); }}
          placeholder="https://example.com/article"
          className="flex-1 px-3 py-2 rounded border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
        />
        <button
          type="submit"
          disabled={!url.trim() || status === 'loading'}
          className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          {status === 'loading' ? 'Adding...' : 'Add URL'}
        </button>
      </form>

      {status !== 'idle' && status !== 'loading' && (
        <p className={`text-sm ${status === 'success' ? 'text-success' : 'text-danger'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
