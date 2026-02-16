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

export default function ScoringSettings() {
  const [values, setValues] = useState<ScoringConfig>(DEFAULTS);
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
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/settings/scoring', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) {
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
