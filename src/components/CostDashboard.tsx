'use client';

import { useState, useEffect } from 'react';

interface CostSummary {
  embedding_tokens: number;
  embedding_cost: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cost: number;
  total_cost: number;
  avg_cost_per_day: number;
  avg_cost_per_digest: number;
  projected_monthly: number;
  trend: 'up' | 'down' | 'flat';
}

interface CostByUser {
  user_id: string;
  username: string;
  display_name: string;
  source_count: number;
  private_source_count: number;
  interest_count: number;
  exclusion_count: number;
  articles_ingested: number;
  articles_sent_to_llm: number;
  llm_tokens: number;
  estimated_cost: number;
  cost_per_day: number;
  is_outlier: boolean;
}

interface CostBySource {
  source_id: string;
  source_name: string;
  is_default: boolean;
  owner_username: string | null;
  subscriber_count: number;
  articles_fetched: number;
  articles_sent_to_llm: number;
  estimated_token_contribution: number;
}

interface PipelineEfficiency {
  articles_fetched: number;
  after_prefilter: number;
  articles_embedded: number;
  embedding_cost: number;
  total_user_article_pairs: number;
  passed_embedding_filter: number;
  sent_to_llm: number;
  filter_savings_percent: number;
  estimated_cost_without_embeddings: number;
  estimated_cost_with_embeddings: number;
  estimated_savings: number;
  filter_rate_by_user: Array<{ username: string; filter_rate: number }>;
}

interface CostRates {
  embedding_per_million: number;
  llm_input_per_million: number;
  llm_output_per_million: number;
}

interface CostData {
  window_days: number;
  summary: CostSummary;
  by_user: CostByUser[];
  by_source: CostBySource[];
  pipeline: PipelineEfficiency;
  rates: CostRates;
}

const WINDOWS = [7, 30, 90] as const;

function fmt(n: number): string {
  return n.toLocaleString();
}

function usd(n: number): string {
  if (n < 0.01 && n > 0) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function usd4(n: number): string {
  return `$${n.toFixed(4)}`;
}

function trendIcon(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '\u2191';
  if (trend === 'down') return '\u2193';
  return '\u2192';
}

function trendColor(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return 'text-red-400';
  if (trend === 'down') return 'text-green-400';
  return 'text-muted';
}

export default function CostDashboard() {
  const [data, setData] = useState<CostData | null>(null);
  const [window, setWindow] = useState(30);
  const [loading, setLoading] = useState(true);

  // Rate editing state
  const [editingRates, setEditingRates] = useState(false);
  const [rateEmb, setRateEmb] = useState('');
  const [rateLlmIn, setRateLlmIn] = useState('');
  const [rateLlmOut, setRateLlmOut] = useState('');
  const [savingRates, setSavingRates] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics/costs?window=${window}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setRateEmb(String(d.rates.embedding_per_million));
        setRateLlmIn(String(d.rates.llm_input_per_million));
        setRateLlmOut(String(d.rates.llm_output_per_million));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [window]);

  async function saveRates() {
    setSavingRates(true);
    try {
      await fetch('/api/admin/analytics/costs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embedding_per_million: parseFloat(rateEmb),
          llm_input_per_million: parseFloat(rateLlmIn),
          llm_output_per_million: parseFloat(rateLlmOut),
        }),
      });
      setEditingRates(false);
      // Refresh data with new rates
      setWindow(w => w); // trigger re-fetch
      const r = await fetch(`/api/admin/analytics/costs?window=${window}`);
      const d = await r.json();
      setData(d);
    } catch {
      // ignore
    }
    setSavingRates(false);
  }

  if (loading) return <p className="text-sm text-muted">Loading cost analytics...</p>;
  if (!data) return <p className="text-sm text-muted">Failed to load cost analytics.</p>;

  const noData = data.summary.total_cost === 0 && data.summary.embedding_tokens === 0 && data.summary.llm_input_tokens === 0;

  // Find outlier users for advisory
  const outlierUsers = data.by_user.filter(u => u.is_outlier);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-light tracking-tight">Cost Analytics</h3>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                window === w
                  ? 'bg-accent-light text-accent border-accent'
                  : 'border-card-border text-muted hover:text-foreground'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {noData && (
        <div className="rounded-lg border border-card-border bg-card p-4 text-center">
          <p className="text-sm text-muted">No cost data available yet. Token usage will be tracked starting from the next ingestion run.</p>
          <p className="text-xs text-muted mt-1">Make sure your cost rates are configured below.</p>
        </div>
      )}

      {/* Panel 1: Cost Summary */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">Cost Summary</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-card-border">
                <th className="text-left py-1.5 pr-3 font-normal">Category</th>
                <th className="text-right py-1.5 px-2 font-normal">Tokens</th>
                <th className="text-right py-1.5 pl-2 font-normal">Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-card-border/50">
                <td className="py-1.5 pr-3 text-foreground">Embeddings (shared)</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(data.summary.embedding_tokens)} in</td>
                <td className="text-right py-1.5 pl-2 text-foreground">{usd(data.summary.embedding_cost)}</td>
              </tr>
              <tr className="border-b border-card-border/50">
                <td className="py-1.5 pr-3 text-foreground">LLM Scoring (input)</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(data.summary.llm_input_tokens)} in</td>
                <td className="text-right py-1.5 pl-2 text-foreground">
                  {usd((data.summary.llm_input_tokens / 1_000_000) * data.rates.llm_input_per_million)}
                </td>
              </tr>
              <tr className="border-b border-card-border/50">
                <td className="py-1.5 pr-3 text-foreground">LLM Scoring (output)</td>
                <td className="text-right py-1.5 px-2 text-muted">{fmt(data.summary.llm_output_tokens)} out</td>
                <td className="text-right py-1.5 pl-2 text-foreground">
                  {usd((data.summary.llm_output_tokens / 1_000_000) * data.rates.llm_output_per_million)}
                </td>
              </tr>
              <tr className="border-t border-card-border">
                <td className="py-1.5 pr-3 text-foreground font-medium">Total</td>
                <td className="text-right py-1.5 px-2 text-muted"></td>
                <td className="text-right py-1.5 pl-2 text-foreground font-medium">{usd(data.summary.total_cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-muted">Avg/day</span>
            <p className="text-foreground">{usd4(data.summary.avg_cost_per_day)}</p>
          </div>
          <div>
            <span className="text-muted">Avg/digest</span>
            <p className="text-foreground">{usd4(data.summary.avg_cost_per_digest)}</p>
          </div>
          <div>
            <span className="text-muted">Projected monthly</span>
            <p className="text-foreground">{usd(data.summary.projected_monthly)}</p>
          </div>
          <div>
            <span className="text-muted">Trend</span>
            <p className={trendColor(data.summary.trend)}>
              {trendIcon(data.summary.trend)} {data.summary.trend === 'up' ? 'Increasing' : data.summary.trend === 'down' ? 'Decreasing' : 'Stable'}
            </p>
          </div>
        </div>
      </div>

      {/* Panel 2: Cost by User */}
      {data.by_user.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Cost by User</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-2 font-normal">User</th>
                  <th className="text-right py-1.5 px-2 font-normal">Sources</th>
                  <th className="text-right py-1.5 px-2 font-normal hidden sm:table-cell">Interests</th>
                  <th className="text-right py-1.5 px-2 font-normal hidden sm:table-cell">Exclusions</th>
                  <th className="text-right py-1.5 px-2 font-normal">Articles</th>
                  <th className="text-right py-1.5 px-2 font-normal hidden sm:table-cell">Sent to LLM</th>
                  <th className="text-right py-1.5 px-2 font-normal hidden sm:table-cell">LLM Tokens</th>
                  <th className="text-right py-1.5 px-2 font-normal">Est. Cost</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Cost/Day</th>
                </tr>
              </thead>
              <tbody>
                {data.by_user.map(u => (
                  <tr key={u.user_id} className="border-b border-card-border/50">
                    <td className={`py-1.5 pr-2 ${u.is_outlier ? 'text-yellow-400' : 'text-foreground'}`}>
                      {u.display_name}
                    </td>
                    <td className="text-right py-1.5 px-2 text-muted">{u.source_count}</td>
                    <td className="text-right py-1.5 px-2 text-muted hidden sm:table-cell">{u.interest_count}</td>
                    <td className="text-right py-1.5 px-2 text-muted hidden sm:table-cell">{u.exclusion_count}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{fmt(u.articles_ingested)}</td>
                    <td className="text-right py-1.5 px-2 text-muted hidden sm:table-cell">{fmt(u.articles_sent_to_llm)}</td>
                    <td className="text-right py-1.5 px-2 text-muted hidden sm:table-cell">{fmt(u.llm_tokens)}</td>
                    <td className="text-right py-1.5 px-2 text-foreground">{usd(u.estimated_cost)}</td>
                    <td className="text-right py-1.5 pl-2 text-muted">{usd4(u.cost_per_day)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outlierUsers.map(u => (
            <p key={u.user_id} className="text-xs text-yellow-400/80 mt-2">
              {u.display_name}&apos;s cost is disproportionately high, driven by {u.source_count} sources ({u.private_source_count} private).
              Consider reviewing their source list or adjusting limits.
            </p>
          ))}
        </div>
      )}

      {/* Panel 3: Cost by Source */}
      {data.by_source.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Top Sources by Cost Impact</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-2 font-normal">Source</th>
                  <th className="text-right py-1.5 px-2 font-normal">Type</th>
                  <th className="text-right py-1.5 px-2 font-normal hidden sm:table-cell">Users</th>
                  <th className="text-right py-1.5 px-2 font-normal">Fetched</th>
                  <th className="text-right py-1.5 px-2 font-normal">To LLM</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Est. Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.by_source.map(s => (
                  <tr key={s.source_id} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-2 text-foreground max-w-[150px] truncate">{s.source_name}</td>
                    <td className="text-right py-1.5 px-2 text-muted">
                      {s.is_default ? 'Default' : 'Private'}
                    </td>
                    <td className="text-right py-1.5 px-2 text-muted hidden sm:table-cell">{s.subscriber_count}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{fmt(s.articles_fetched)}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{fmt(s.articles_sent_to_llm)}</td>
                    <td className="text-right py-1.5 pl-2 text-foreground">{fmt(s.estimated_token_contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Panel 4: Pipeline Efficiency */}
      {!noData && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Pipeline Efficiency</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Articles fetched</span>
              <span className="text-foreground">{fmt(data.pipeline.articles_fetched)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">After prefilter</span>
              <span className="text-foreground">
                {fmt(data.pipeline.after_prefilter)}
                {data.pipeline.articles_fetched > 0 && (
                  <span className="text-muted ml-1">
                    ({Math.round((data.pipeline.after_prefilter / data.pipeline.articles_fetched) * 100)}%)
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Articles embedded</span>
              <span className="text-foreground">{fmt(data.pipeline.articles_embedded)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Embedding cost</span>
              <span className="text-foreground">{usd(data.pipeline.embedding_cost)}</span>
            </div>

            <div className="border-t border-card-border/50 my-2" />

            <div className="flex justify-between">
              <span className="text-muted">Total user x article pairs</span>
              <span className="text-foreground">{fmt(data.pipeline.total_user_article_pairs)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Passed embedding filter</span>
              <span className="text-foreground">{fmt(data.pipeline.passed_embedding_filter)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Sent to LLM</span>
              <span className="text-foreground">{fmt(data.pipeline.sent_to_llm)}</span>
            </div>

            <div className="border-t border-card-border/50 my-2" />

            <div className="flex justify-between">
              <span className="text-muted">Embedding filter savings</span>
              <span className="text-green-400 font-medium">{data.pipeline.filter_savings_percent}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Est. cost without embeddings</span>
              <span className="text-foreground">~{usd(data.pipeline.estimated_cost_without_embeddings)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Est. cost with embeddings</span>
              <span className="text-foreground">{usd(data.pipeline.estimated_cost_with_embeddings)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Savings</span>
              <span className="text-green-400">~{usd(data.pipeline.estimated_savings)} ({data.pipeline.filter_savings_percent}%)</span>
            </div>
          </div>

          {data.pipeline.filter_rate_by_user.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted mb-1">Embedding filter rate by user</p>
              <div className="space-y-0.5 text-xs">
                {data.pipeline.filter_rate_by_user.map(u => (
                  <div key={u.username} className="flex justify-between">
                    <span className="text-foreground">{u.username}</span>
                    <span className={u.filter_rate >= 70 ? 'text-green-400' : u.filter_rate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                      {u.filter_rate}% filtered {u.filter_rate >= 70 ? '(efficient)' : u.filter_rate >= 50 ? '(moderate)' : '(check sources)'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cost Rate Settings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-foreground">API Cost Rates</h4>
          {!editingRates && (
            <button
              onClick={() => setEditingRates(true)}
              className="text-xs text-accent hover:opacity-80"
            >
              Edit
            </button>
          )}
        </div>

        {editingRates ? (
          <div className="space-y-2 rounded-lg border border-card-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted">Embedding (per 1M tokens)</label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={rateEmb}
                  onChange={e => setRateEmb(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted">LLM Input (per 1M tokens)</label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={rateLlmIn}
                  onChange={e => setRateLlmIn(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted">LLM Output (per 1M tokens)</label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={rateLlmOut}
                  onChange={e => setRateLlmOut(e.target.value)}
                  className="w-20 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setEditingRates(false)}
                className="text-xs px-3 py-1 rounded border border-card-border text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={saveRates}
                disabled={savingRates}
                className="text-xs px-3 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingRates ? 'Saving...' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-muted">Update these if you change LLM providers or pricing changes.</p>
          </div>
        ) : (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Embedding (per 1M tokens)</span>
              <span className="text-foreground">${data.rates.embedding_per_million}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">LLM Input (per 1M tokens)</span>
              <span className="text-foreground">${data.rates.llm_input_per_million}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">LLM Output (per 1M tokens)</span>
              <span className="text-foreground">${data.rates.llm_output_per_million}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
