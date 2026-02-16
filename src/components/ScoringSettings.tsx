'use client';

import { useState, useEffect } from 'react';

interface ScoringConfig {
  embedding_llm_threshold: string;
  embedding_serendipity_min: string;
  embedding_serendipity_max: string;
  serendipity_sample_size: string;
  max_llm_candidates: string;
}

const DEFAULTS: ScoringConfig = {
  embedding_llm_threshold: '0.35',
  embedding_serendipity_min: '0.20',
  embedding_serendipity_max: '0.35',
  serendipity_sample_size: '5',
  max_llm_candidates: '40',
};

const LABELS: Record<keyof ScoringConfig, string> = {
  embedding_llm_threshold: 'Embedding → LLM threshold',
  embedding_serendipity_min: 'Serendipity pool min',
  embedding_serendipity_max: 'Serendipity pool max',
  serendipity_sample_size: 'Serendipity sample size',
  max_llm_candidates: 'Max LLM candidates per user',
};

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI (GPT-4o-mini)', description: 'Fast, cheap, reliable' },
  { value: 'synthetic', label: 'Synthetic (Kimi K2.5)', description: 'Reasoning model, slower' },
  { value: 'anthropic', label: 'Anthropic (Claude Sonnet)', description: 'High quality, higher cost' },
] as const;

export default function ScoringSettings() {
  const [values, setValues] = useState<ScoringConfig>(DEFAULTS);
  const [provider, setProvider] = useState('synthetic');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings/scoring')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setValues(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
    fetch('/api/settings/provider')
      .then(res => res.json())
      .then(data => {
        if (data?.provider) setProvider(data.provider);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const [scoringRes, providerRes] = await Promise.all([
        fetch('/api/settings/scoring', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        }),
        fetch('/api/settings/provider', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        }),
      ]);
      if (scoringRes.ok && providerRes.ok) {
        setMessage('Saved');
        setTimeout(() => setMessage(''), 2000);
      } else {
        setMessage('Error saving');
      }
    } catch {
      setMessage('Error saving');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-light tracking-tight">Scoring Pipeline</h3>
      <p className="text-sm text-muted">
        Controls the two-stage embedding + LLM scoring pipeline. Articles above the embedding threshold
        are sent to the LLM. A small random sample from the serendipity range is also included.
      </p>

      <div className="space-y-2 mb-2">
        <label className="text-sm text-foreground">LLM Provider</label>
        <div className="space-y-1.5">
          {PROVIDERS.map(p => (
            <label key={p.value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="provider"
                value={p.value}
                checked={provider === p.value}
                onChange={() => setProvider(p.value)}
                className="accent-accent"
              />
              <span className="text-sm text-foreground">{p.label}</span>
              <span className="text-xs text-muted">{p.description}</span>
            </label>
          ))}
        </div>
      </div>

      <hr className="border-card-border" />

      <div className="space-y-3">
        {(Object.keys(LABELS) as (keyof ScoringConfig)[]).map(key => (
          <div key={key} className="flex items-center justify-between gap-4">
            <label className="text-sm text-foreground">{LABELS[key]}</label>
            <input
              type="number"
              step={key.includes('size') || key.includes('candidates') ? '1' : '0.01'}
              min="0"
              value={values[key]}
              onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
              className="w-20 px-2 py-1 text-sm rounded border border-card-border bg-background text-foreground text-right"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-sm rounded-full border border-accent text-accent hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>
    </div>
  );
}
