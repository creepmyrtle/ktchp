'use client';

import { useState, useEffect } from 'react';

interface TierFeedback {
  tier: string;
  total: number;
  rated: number;
  liked: number;
  neutral: number;
  disliked: number;
  bookmarked: number;
}

interface ScoreBand {
  band: string;
  count: number;
  liked: number;
  neutral: number;
  disliked: number;
  avg_sentiment: number;
}

interface InterestAccuracy {
  category: string;
  total: number;
  liked: number;
  disliked: number;
  accuracy: number;
}

interface Correlation {
  llm_correlation: number | null;
  embedding_correlation: number | null;
  sample_size: number;
}

interface ThresholdRec {
  current_threshold: number;
  bonus_like_rate: number | null;
  recommended_dislike_rate: number | null;
  suggestion: string | null;
  suggested_threshold: number | null;
}

interface AnalyticsData {
  window: number;
  feedbackByTier: TierFeedback[];
  scoreBands: ScoreBand[];
  interestAccuracy: InterestAccuracy[];
  correlation: Correlation;
  thresholdRecommendation: ThresholdRec;
}

const WINDOWS = [7, 30, 90] as const;

function pct(n: number, total: number): string {
  if (total === 0) return '-';
  return `${Math.round((n / total) * 100)}%`;
}

function corrLabel(r: number | null): { text: string; color: string } {
  if (r === null) return { text: 'No data', color: 'text-muted' };
  if (r >= 0.4) return { text: 'Strong', color: 'text-green-400' };
  if (r >= 0.2) return { text: 'Moderate', color: 'text-yellow-400' };
  return { text: 'Weak', color: 'text-red-400' };
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [window, setWindow] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics?window=${window}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [window]);

  if (loading) return <p className="text-sm text-muted">Loading analytics...</p>;
  if (!data) return <p className="text-sm text-muted">Failed to load analytics.</p>;

  const llmLabel = corrLabel(data.correlation.llm_correlation);
  const embLabel = corrLabel(data.correlation.embedding_correlation);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-light tracking-tight">Scoring Analytics</h3>
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

      {/* Threshold Recommendation */}
      {data.thresholdRecommendation.suggestion && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
          <p className="text-sm text-yellow-300">{data.thresholdRecommendation.suggestion}</p>
        </div>
      )}

      {/* Metric 1: Feedback by Tier */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">Feedback by Tier</h4>
        {data.feedbackByTier.length === 0 ? (
          <p className="text-xs text-muted">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-3 font-normal">Tier</th>
                  <th className="text-right py-1.5 px-2 font-normal">Articles</th>
                  <th className="text-right py-1.5 px-2 font-normal">Rated</th>
                  <th className="text-right py-1.5 px-2 font-normal">Liked</th>
                  <th className="text-right py-1.5 px-2 font-normal">Neutral</th>
                  <th className="text-right py-1.5 px-2 font-normal">Disliked</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Bookmarked</th>
                </tr>
              </thead>
              <tbody>
                {data.feedbackByTier.map(t => (
                  <tr key={t.tier} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-3 text-foreground capitalize">{t.tier}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{t.total}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{t.rated}</td>
                    <td className="text-right py-1.5 px-2 text-green-400">{pct(t.liked, t.rated)}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{pct(t.neutral, t.rated)}</td>
                    <td className="text-right py-1.5 px-2 text-red-400">{pct(t.disliked, t.rated)}</td>
                    <td className="text-right py-1.5 pl-2 text-muted">{pct(t.bookmarked, t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Metric 2: Score Distribution */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">Score Distribution</h4>
        {data.scoreBands.length === 0 ? (
          <p className="text-xs text-muted">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-3 font-normal">Score Band</th>
                  <th className="text-right py-1.5 px-2 font-normal">Articles</th>
                  <th className="text-right py-1.5 px-2 font-normal">Avg Sentiment</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Like Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.scoreBands.map(b => (
                  <tr key={b.band} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-3 text-foreground font-mono">{b.band}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{b.count}</td>
                    <td className={`text-right py-1.5 px-2 ${b.avg_sentiment > 0 ? 'text-green-400' : b.avg_sentiment < 0 ? 'text-red-400' : 'text-muted'}`}>
                      {b.avg_sentiment > 0 ? '+' : ''}{b.avg_sentiment.toFixed(2)}
                    </td>
                    <td className="text-right py-1.5 pl-2 text-foreground">{pct(b.liked, b.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Metric 3: Per-Interest Accuracy */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">Interest Accuracy</h4>
        {data.interestAccuracy.length === 0 ? (
          <p className="text-xs text-muted">Not enough feedback data yet (minimum 3 rated articles per interest).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-3 font-normal">Interest</th>
                  <th className="text-right py-1.5 px-2 font-normal">Articles</th>
                  <th className="text-right py-1.5 px-2 font-normal">Liked</th>
                  <th className="text-right py-1.5 px-2 font-normal">Disliked</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {data.interestAccuracy.map(ia => (
                  <tr key={ia.category} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-3 text-foreground">{ia.category}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{ia.total}</td>
                    <td className="text-right py-1.5 px-2 text-green-400">{ia.liked}</td>
                    <td className="text-right py-1.5 px-2 text-red-400">{ia.disliked}</td>
                    <td className={`text-right py-1.5 pl-2 font-medium ${
                      ia.accuracy >= 0.7 ? 'text-green-400' : ia.accuracy >= 0.4 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {Math.round(ia.accuracy * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Metric 4: Score-Feedback Correlation */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">Score-Feedback Correlation</h4>
        {data.correlation.sample_size < 10 ? (
          <p className="text-xs text-muted">Not enough data yet ({data.correlation.sample_size} rated articles, need 10+).</p>
        ) : (
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">LLM relevance score</span>
              <span className={llmLabel.color}>
                r = {data.correlation.llm_correlation?.toFixed(3) ?? 'N/A'} ({llmLabel.text})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Embedding score</span>
              <span className={embLabel.color}>
                r = {data.correlation.embedding_correlation?.toFixed(3) ?? 'N/A'} ({embLabel.text})
              </span>
            </div>
            <p className="text-xs text-muted mt-1">Based on {data.correlation.sample_size} rated articles.</p>
          </div>
        )}
      </div>
    </div>
  );
}
