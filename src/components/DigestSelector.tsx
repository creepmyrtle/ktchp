'use client';

interface DigestOption {
  id: string;
  generated_at: string | Date;
  article_count: number;
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
  if (digests.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 pb-2 mt-4">
      {digests.map((digest, i) => {
        const isActive = digest.id === currentId;
        return (
          <a
            key={digest.id}
            href={i === 0 ? '/digest' : `/digest/${digest.id}`}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors border ${
              isActive
                ? 'bg-accent text-white border-accent'
                : 'bg-card border-card-border text-muted hover:text-foreground hover:border-foreground/20'
            }`}
          >
            <span className="font-medium">{formatDate(digest.generated_at)}</span>
            <span className="ml-1.5 opacity-70 text-xs">{formatTime(digest.generated_at)}</span>
            <span className="ml-1.5 opacity-60 text-xs">({digest.article_count})</span>
          </a>
        );
      })}
    </div>
  );
}
