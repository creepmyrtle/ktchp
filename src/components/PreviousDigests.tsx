'use client';

import Link from 'next/link';

interface DigestSummary {
  id: string;
  generated_at: string | Date;
  article_count: number;
}

export default function PreviousDigests({ digests }: { digests: DigestSummary[] }) {
  if (digests.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-card-border">
      <h3 className="text-sm font-medium text-muted mb-3">Previous digests</h3>
      <div className="flex flex-wrap gap-2">
        {digests.map(d => {
          const str = typeof d.generated_at === 'string' ? d.generated_at : d.generated_at.toISOString();
          const utcDate = str.endsWith('Z') ? str : str + 'Z';
          const label = new Date(utcDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          return (
            <Link
              key={d.id}
              href={`/digest/${d.id}`}
              className="text-sm px-3 py-1.5 rounded-md bg-card border border-card-border text-muted hover:text-foreground transition-colors"
            >
              {label} ({d.article_count})
            </Link>
          );
        })}
      </div>
    </div>
  );
}
