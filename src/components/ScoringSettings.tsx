'use client';

import { useState, useEffect } from 'react';

type ScoringConfig = Record<string, string>;

const SCORING_LABELS: Record<string, string> = {
  embedding_llm_threshold: 'Embedding → LLM threshold',
  embedding_serendipity_min: 'Serendipity pool min',
  embedding_serendipity_max: 'Serendipity pool max',
  serendipity_sample_size: 'Serendipity sample size',
  max_llm_candidates: 'Max LLM candidates per user',
  blended_primary_weight: 'Blended primary weight',
  blended_secondary_weight: 'Blended secondary weight',
  semantic_dedup_threshold: 'Semantic dedup threshold',
  exclusion_penalty_threshold: 'Exclusion penalty threshold',
  source_trust_min: 'Source trust min multiplier',
  source_trust_max: 'Source trust max multiplier',
  affinity_analysis_day: 'Affinity analysis day (0=Sun)',
};

const BONUS_LABELS: Record<string, string> = {
  bonus_min_score: 'Bonus minimum score floor',
  bonus_max_articles: 'Max bonus articles per digest',
};

const INTEGER_KEYS = new Set([
  'serendipity_sample_size',
  'max_llm_candidates',
  'bonus_max_articles',
  'affinity_analysis_day',
]);

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI (GPT-4o-mini)', description: 'Fast, cheap, reliable' },
  { value: 'synthetic', label: 'Synthetic (Kimi K2.5)', description: 'Reasoning model, slower' },
  { value: 'anthropic', label: 'Anthropic (Claude Sonnet)', description: 'High quality, higher cost' },
] as const;

export default function ScoringSettings() {
  const [values, setValues] = useState<ScoringConfig>({});
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('synthetic');
  const [bonusEnabled, setBonusEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings/scoring')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          if ('bonus_digest_enabled' in data) {
            setBonusEnabled(data.bonus_digest_enabled !== 'false');
            delete data.bonus_digest_enabled;
          }
          setValues(data);
        }
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
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
          body: JSON.stringify({ ...values, bonus_digest_enabled: bonusEnabled ? 'true' : 'false' }),
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

      {loading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
      <div className="space-y-3">
        {(Object.keys(SCORING_LABELS)).map(key => (
          <div key={key} className="flex items-center justify-between gap-4">
            <label className="text-sm text-foreground">{SCORING_LABELS[key]}</label>
            <input
              type="number"
              step={INTEGER_KEYS.has(key) ? '1' : '0.01'}
              min="0"
              value={values[key] ?? ''}
              onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
              className="w-20 px-2 py-1 text-sm rounded border border-card-border bg-background text-foreground text-right"
            />
          </div>
        ))}
      </div>
      )}

      <hr className="border-card-border" />

      <h4 className="text-sm font-medium text-foreground">Bonus Digest</h4>
      <p className="text-sm text-muted">
        After completing their main digest, users can browse below-threshold articles.
        Feedback on these directly improves scoring.
      </p>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={bonusEnabled}
          onChange={e => setBonusEnabled(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-sm text-foreground">Enable bonus digest</span>
      </label>

      {bonusEnabled && (
        <div className="space-y-3">
          {(Object.keys(BONUS_LABELS)).map(key => (
            <div key={key} className="flex items-center justify-between gap-4">
              <label className="text-sm text-foreground">{BONUS_LABELS[key]}</label>
              <input
                type="number"
                step={INTEGER_KEYS.has(key) ? '1' : '0.01'}
                min="0"
                value={values[key] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                className="w-20 px-2 py-1 text-sm rounded border border-card-border bg-background text-foreground text-right"
              />
            </div>
          ))}
        </div>
      )}

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
