interface CaughtUpMessageProps {
  isComplete?: boolean;
  totalCount?: number;
  likedCount?: number;
  skippedCount?: number;
  bookmarkedCount?: number;
}

export default function CaughtUpMessage({
  isComplete,
  totalCount,
  likedCount,
  skippedCount,
  bookmarkedCount,
}: CaughtUpMessageProps) {
  if (isComplete && totalCount && totalCount > 0) {
    return (
      <div className="text-center py-12 mt-8 border-t border-card-border">
        <div className="text-2xl mb-2">&#10003;</div>
        <p className="text-foreground font-light text-lg">Digest complete</p>
        <p className="text-muted text-sm mt-2">
          You processed all {totalCount} articles.
        </p>
        <p className="text-muted text-xs mt-1">
          {likedCount || 0} liked &middot; {skippedCount || 0} skipped &middot; {bookmarkedCount || 0} bookmarked
        </p>
        <p className="text-muted text-xs mt-3">
          Next digest: ~5:00 AM CT
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-12 mt-8 border-t border-card-border">
      <div className="text-2xl mb-2">&#10003;</div>
      <p className="text-muted font-light">You&apos;re all caught up</p>
      <p className="text-muted text-sm mt-1">Next digest: ~5:00 AM CT</p>
    </div>
  );
}
