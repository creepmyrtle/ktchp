'use client';

import { useRouter } from 'next/navigation';

interface DigestOption {
  id: string;
  generated_at: string | Date;
  article_count: number;
  remaining_count?: number;
  is_complete?: boolean;
}

interface DigestSelectorProps {
  digests: DigestOption[];
  currentId: string;
}

function formatDate(dateVal: string | Date): string {
  const d = new Date(typeof dateVal === 'string' ? dateVal : dateVal.toISOString());
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(dateVal: string | Date): string {
  const d = new Date(typeof dateVal === 'string' ? dateVal : dateVal.toISOString());
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DigestSelector({ digests, currentId }: DigestSelectorProps) {
  const router = useRouter();

  if (digests.length === 0) return null;

  return (
    <div className="mt-4">
      <select
        value={currentId}
        onChange={(e) => {
          const selectedId = e.target.value;
          const idx = digests.findIndex((d) => d.id === selectedId);
          router.push(idx === 0 ? '/digest' : `/digest/${selectedId}`);
        }}
        className="w-full sm:w-auto px-3 py-2 rounded-lg text-sm bg-card border border-card-border text-foreground cursor-pointer focus:outline-none focus:border-accent"
      >
        {digests.map((digest) => {
          const badge = digest.is_complete
            ? '\u2713'
            : digest.remaining_count != null
              ? `${digest.remaining_count} left`
              : '';
          return (
            <option key={digest.id} value={digest.id}>
              {formatDate(digest.generated_at)} — {formatTime(digest.generated_at)} ({digest.article_count} articles){badge ? ` ${badge}` : ''}
            </option>
          );
        })}
      </select>
    </div>
  );
}
