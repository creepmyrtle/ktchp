'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LogEvent } from '@/types';

interface LogSummary {
  id: string;
  provider: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: Record<string, unknown>;
  error: string | null;
}

interface LogDetail extends LogSummary {
  events: LogEvent[];
}

const levelColors: Record<string, string> = {
  info: 'text-muted',
  warn: 'text-yellow-500',
  error: 'text-danger',
};

const statusBadge: Record<string, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-blue-500/15 text-blue-400' },
  success: { label: 'Success', className: 'bg-green-500/15 text-green-400' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-400' },
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function downloadLog(log: LogDetail) {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date(log.started_at).toISOString().slice(0, 19).replace(/:/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `ingestion-${log.trigger}-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function IngestionLogs() {
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    const res = await fetch('/api/ingestion-logs');
    if (res.ok) {
      setLogs(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }

    setExpandedId(id);
    setDetailLoading(true);
    const res = await fetch(`/api/ingestion-logs/${id}`);
    if (res.ok) {
      setDetail(await res.json());
    }
    setDetailLoading(false);
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Complete logs for every ingestion run. Click a row to see the full event timeline.
      </p>

      {logs.length === 0 && (
        <p className="text-muted text-sm text-center py-4">
          No ingestion logs yet. Trigger an ingestion to see results here.
        </p>
      )}

      {logs.map(log => {
        const badge = statusBadge[log.status];
        const summary = log.summary as Record<string, number | string | null>;
        const isExpanded = expandedId === log.id;

        return (
          <div key={log.id} className="rounded-lg border border-card-border bg-card overflow-hidden">
            <button
              onClick={() => toggleExpand(log.id)}
              className="w-full px-4 py-3 text-left hover:bg-background/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="text-sm text-foreground truncate">
                    {formatTime(log.started_at)}
                  </span>
                  <span className="text-xs text-muted capitalize">{log.trigger}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-xs text-muted">
                  {summary.newArticles !== undefined && (
                    <span>{String(summary.newArticles)} new</span>
                  )}
                  {summary.digestArticleCount !== undefined && Number(summary.digestArticleCount) > 0 && (
                    <span>{String(summary.digestArticleCount)} in digest</span>
                  )}
                  <span>{formatDuration(log.duration_ms)}</span>
                  <span className="text-[10px]">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>
              {log.error && (
                <p className="text-xs text-danger mt-1 truncate">{log.error}</p>
              )}
            </button>

            {isExpanded && (
              <div className="border-t border-card-border px-4 py-3">
                {/* Summary stats + export */}
                <div className="flex justify-end mb-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (detail && detail.id === log.id) downloadLog(detail);
                    }}
                    disabled={detailLoading || !detail || detail.id !== log.id}
                    className="text-xs text-accent hover:opacity-80 disabled:opacity-40 transition-opacity"
                  >
                    Export JSON
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    ['Fetched', summary.totalFetched],
                    ['New', summary.newArticles],
                    ['Duplicates', summary.duplicates],
                    ['Errors', summary.errorCount],
                    ['Scored', summary.articlesScored],
                    ['Digest articles', summary.digestArticleCount],
                  ]
                    .filter(([, v]) => v !== undefined)
                    .map(([label, value]) => (
                      <div key={label as string} className="text-center">
                        <p className="text-lg font-light text-foreground">{String(value ?? 0)}</p>
                        <p className="text-[10px] text-muted uppercase tracking-wider">{label as string}</p>
                      </div>
                    ))}
                </div>

                {/* Event timeline */}
                {detailLoading ? (
                  <p className="text-xs text-muted">Loading events...</p>
                ) : detail && detail.events.length > 0 ? (
                  <div className="space-y-0">
                    <p className="text-xs text-muted font-medium mb-2 uppercase tracking-wider">Event Timeline</p>
                    <div className="border-l-2 border-card-border ml-2 space-y-0">
                      {detail.events.map((event, i) => (
                        <div key={i} className="pl-4 py-1.5 relative">
                          <div className="absolute -left-[5px] top-[11px] w-2 h-2 rounded-full bg-card-border" />
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] text-muted font-mono shrink-0">
                              {formatEventTime(event.timestamp)}
                            </span>
                            <span className="text-[10px] text-accent font-medium uppercase shrink-0">
                              {event.phase}
                            </span>
                            <span className={`text-xs ${levelColors[event.level] || 'text-muted'}`}>
                              {event.message}
                            </span>
                          </div>
                          {event.data && (
                            <pre className="text-[10px] text-muted mt-0.5 ml-0 overflow-x-auto">
                              {JSON.stringify(event.data, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted">No events recorded.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
