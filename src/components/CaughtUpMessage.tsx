export default function CaughtUpMessage() {
  return (
    <div className="text-center py-12 mt-8 border-t border-card-border">
      <div className="text-2xl mb-2">&#10003;</div>
      <p className="text-muted font-light">You&apos;re all caught up</p>
      <p className="text-muted text-sm mt-1">Next ingestion occurs at 5:00 AM CT (11:00 UTC) and the digest will arrive shortly thereafter</p>
    </div>
  );
}
