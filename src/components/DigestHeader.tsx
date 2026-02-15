'use client';

import { useState, useEffect } from 'react';

interface DigestHeaderProps {
  date: string | Date;
  articleCount: number;
  archivedCount?: number;
  totalCount?: number;
}

export default function DigestHeader({ date, articleCount, archivedCount, totalCount }: DigestHeaderProps) {
  const [formatted, setFormatted] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    const str = typeof date === 'string' ? date : date.toISOString();
    const utcDate = str.endsWith('Z') ? str : str + 'Z';
    const d = new Date(utcDate);

    setFormatted(d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));

    setTime(d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }));
  }, [date]);

  if (!formatted) return null;

  const showProgress = totalCount != null && archivedCount != null && totalCount > 0;

  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-light tracking-tight">{formatted}</h2>
        {showProgress && (
          <span className="text-xs text-muted font-mono">
            {archivedCount} of {totalCount} cleared
          </span>
        )}
      </div>
      <p className="text-muted text-sm mt-1">
        {time} &middot; {articleCount} article{articleCount !== 1 ? 's' : ''} remaining
      </p>
      {showProgress && totalCount > 0 && (
        <div className="mt-2 h-0.5 bg-card-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500 rounded-full"
            style={{ width: `${(archivedCount / totalCount) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
