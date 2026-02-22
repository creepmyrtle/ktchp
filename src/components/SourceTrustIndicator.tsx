'use client';

interface SourceTrustIndicatorProps {
  trustFactor: number;
  sampleSize: number;
}

export default function SourceTrustIndicator({ trustFactor, sampleSize }: SourceTrustIndicatorProps) {
  if (sampleSize < 5) return null;

  // Map trust factor (0.8-1.2) to 1-5 dots
  const normalized = Math.max(0, Math.min(1, (trustFactor - 0.8) / 0.4));
  const dots = Math.round(normalized * 4) + 1;

  const label = trustFactor >= 1.1 ? 'You tend to like articles from here'
    : trustFactor >= 1.0 ? 'You like most articles from here'
    : trustFactor >= 0.95 ? 'Mixed feedback on this source'
    : 'You tend to dislike articles from here';

  return (
    <span className="inline-flex items-center gap-0.5" title={`${label} (based on ${sampleSize} rated articles)`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            i <= dots ? 'bg-accent' : 'bg-card-border'
          }`}
        />
      ))}
    </span>
  );
}
