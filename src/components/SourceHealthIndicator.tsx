'use client';

import { timeAgo } from '@/lib/utils/time';

interface SourceHealthIndicatorProps {
  healthStatus: string;
  articles14d?: number;
  lastNewArticleAt?: string | null;
  lastFetchError?: string | null;
  lastFetchStatus?: string | null;
  consecutiveErrors?: number;
  createdAt: string;
}

function formatFrequency(articles14d: number): string {
  if (articles14d === 0) return 'no recent articles';
  if (articles14d >= 14) {
    const perDay = Math.round(articles14d / 14);
    return `~${perDay} new/day`;
  }
  return `~${articles14d} new/2wk`;
}

function formatErrorDetail(status: string | null | undefined): string {
  if (!status) return 'Fetch error';
  if (status.startsWith('error_')) {
    const code = status.replace('error_', '');
    return `HTTP ${code}`;
  }
  const labels: Record<string, string> = {
    timeout: 'Timeout',
    connection_error: 'Connection failed',
    parse_error: 'Invalid feed',
    unknown_error: 'Fetch error',
  };
  return labels[status] || 'Fetch error';
}

const dotColors: Record<string, string> = {
  active: 'bg-success',
  slow: 'bg-serendipity',
  stale: 'bg-muted',
  error: 'bg-danger',
  new: 'bg-info',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  slow: 'Slow',
  stale: 'Inactive',
  error: 'Error',
  new: 'New',
};

export default function SourceHealthIndicator({
  healthStatus,
  articles14d = 0,
  lastNewArticleAt,
  lastFetchError,
  lastFetchStatus,
  consecutiveErrors = 0,
  createdAt,
}: SourceHealthIndicatorProps) {
  const dot = dotColors[healthStatus] || 'bg-muted';
  const label = statusLabels[healthStatus] || healthStatus;

  return (
    <div className="text-xs text-muted space-y-0.5 mt-1">
      {/* Status line: dot + label + frequency */}
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span>{label}</span>
        {healthStatus !== 'new' && (
          <>
            <span className="text-card-border">·</span>
            <span>{formatFrequency(articles14d)}</span>
          </>
        )}
      </div>

      {/* Recency line */}
      {healthStatus === 'new' ? (
        <p className="pl-3.5">Added {timeAgo(createdAt)}</p>
      ) : healthStatus === 'error' ? (
        <div className="pl-3.5">
          <p className="text-danger">
            {formatErrorDetail(lastFetchStatus)}
            {consecutiveErrors > 1 && ` — failing for ${consecutiveErrors} days`}
          </p>
          {consecutiveErrors >= 3 && (
            <p className="text-muted mt-0.5">Check the URL or remove this source.</p>
          )}
        </div>
      ) : (
        <>
          {lastNewArticleAt && (
            <p className="pl-3.5">Last article: {timeAgo(lastNewArticleAt)}</p>
          )}
          {healthStatus === 'stale' && !lastNewArticleAt && (
            <p className="pl-3.5">No articles found yet.</p>
          )}
          {healthStatus === 'stale' && lastNewArticleAt && (
            <p className="pl-3.5 mt-0.5">This source may not update frequently.</p>
          )}
        </>
      )}
    </div>
  );
}
