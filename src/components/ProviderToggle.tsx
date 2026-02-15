'use client';

import { useState, useEffect } from 'react';

export default function ProviderToggle() {
  const [provider, setProvider] = useState<'anthropic' | 'synthetic'>('anthropic');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings/provider')
      .then(r => r.json())
      .then(data => {
        setProvider(data.provider || 'anthropic');
        setLoading(false);
      });
  }, []);

  async function toggle(value: 'anthropic' | 'synthetic') {
    setProvider(value);
    await fetch('/api/settings/provider', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: value }),
    });
    // Reload to re-render server component with new provider's data
    window.location.reload();
  }

  if (loading) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">LLM:</span>
      <div className="flex rounded-md border border-card-border overflow-hidden">
        <button
          onClick={() => toggle('anthropic')}
          className={`px-2.5 py-1 text-xs transition-colors ${
            provider === 'anthropic'
              ? 'bg-accent text-white'
              : 'bg-card text-muted hover:text-foreground'
          }`}
        >
          Claude
        </button>
        <button
          onClick={() => toggle('synthetic')}
          className={`px-2.5 py-1 text-xs transition-colors ${
            provider === 'synthetic'
              ? 'bg-accent text-white'
              : 'bg-card text-muted hover:text-foreground'
          }`}
        >
          Kimi K2.5
        </button>
      </div>
    </div>
  );
}
