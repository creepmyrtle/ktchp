'use client';

import { useRouter } from 'next/navigation';

interface DigestOption {
  id: string;
  generated_at: string | Date;
  article_count: number;
  main_count?: number;
  remaining_count?: number;
  is_complete?: boolean;
  bonus_count?: number;
  bonus_remaining?: number;
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

function buildLabel(digest: DigestOption): string {
  const date = formatDate(digest.generated_at);
  const time = formatTime(digest.generated_at);

  const mainCount = digest.main_count ?? digest.article_count;
  const bonusCount = digest.bonus_count ?? 0;
  const mainComplete = digest.is_complete;
  const bonusRemaining = digest.bonus_remaining ?? 0;
  const allDone = mainComplete && bonusCount > 0 && bonusRemaining === 0;

  // Article count portion
  let countPart = `${mainCount}`;
  if (bonusCount > 0) {
    countPart += ` + ${bonusCount} bonus`;
  }

  // Status portion
  let statusPart = '';
  if (allDone) {
    statusPart = '\u2713';
  } else if (mainComplete && bonusCount > 0) {
    statusPart = `\u2713 ${bonusRemaining} bonus left`;
  } else if (mainComplete) {
    statusPart = '\u2713';
  } else if (digest.remaining_count != null) {
    statusPart = `${digest.remaining_count} left`;
  }

  return `${date} \u2014 ${time} (${countPart})${statusPart ? ` ${statusPart}` : ''}`;
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
        {digests.map((digest) => (
          <option key={digest.id} value={digest.id}>
            {buildLabel(digest)}
          </option>
        ))}
      </select>
    </div>
  );
}
