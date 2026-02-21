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

  const label = trustFactor >= 1.1 ? 'highly liked'
    : trustFactor >= 1.0 ? 'mostly liked'
    : trustFactor >= 0.95 ? 'mixed'
    : 'mostly disliked';

  return (
    <span className="inline-flex items-center gap-0.5" title={`Trust: ${trustFactor.toFixed(2)} (${label}, ${sampleSize} articles)`}>
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
