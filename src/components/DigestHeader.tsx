'use client';

import { useState, useEffect } from 'react';

interface DigestHeaderProps {
  date: string | Date;
  articleCount: number;
  archivedCount?: number;
  totalCount?: number;
  bonusTotalCount?: number;
  bonusArchivedCount?: number;
}

export default function DigestHeader({
  date,
  articleCount,
  archivedCount,
  totalCount,
  bonusTotalCount = 0,
  bonusArchivedCount = 0,
}: DigestHeaderProps) {
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

  const hasProgress = totalCount != null && archivedCount != null && totalCount > 0;
  const mainCleared = hasProgress && archivedCount >= totalCount;
  const allCleared = mainCleared && bonusTotalCount > 0 && bonusArchivedCount >= bonusTotalCount;

  // Progress bar calculations
  const grandTotal = (totalCount || 0) + bonusTotalCount;
  const mainPct = grandTotal > 0 ? ((archivedCount || 0) / grandTotal) * 100 : 0;
  const bonusPct = grandTotal > 0 ? (bonusArchivedCount / grandTotal) * 100 : 0;

  // Subtitle text
  let subtitle = '';
  if (allCleared) {
    subtitle = `${time} \u00b7 All ${grandTotal} articles reviewed`;
  } else if (mainCleared && bonusTotalCount > 0) {
    const bonusLeft = bonusTotalCount - bonusArchivedCount;
    subtitle = `${time} \u00b7 Main complete \u00b7 ${bonusLeft} bonus available`;
  } else {
    subtitle = `${time} \u00b7 ${articleCount} recommended article${articleCount !== 1 ? 's' : ''} remaining`;
    if (bonusTotalCount > 0) {
      subtitle += ` \u00b7 ${bonusTotalCount} bonus after`;
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-light tracking-tight">{formatted}</h2>
        {hasProgress && (
          <span className="text-xs text-muted font-mono">
            {archivedCount} of {totalCount} cleared
            {mainCleared && bonusTotalCount > 0 && !allCleared && (
              <span className="text-slate-400"> + {bonusArchivedCount}/{bonusTotalCount} bonus</span>
            )}
          </span>
        )}
      </div>
      <p className="text-muted text-sm mt-1">{subtitle}</p>
      {hasProgress && grandTotal > 0 && (
        <div className="mt-2 h-0.5 bg-card-border rounded-full overflow-hidden flex">
          {/* Main progress — accent color */}
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${mainPct}%` }}
          />
          {/* Bonus progress — muted when inactive, lights up after main is cleared */}
          {bonusTotalCount > 0 && (
            <div
              className={`h-full transition-all duration-500 ${
                mainCleared ? 'bg-slate-400' : 'bg-card-border'
              }`}
              style={{ width: `${bonusPct}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
