'use client';

export default function ScheduleManager() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Your digest is generated once daily by a GitHub Actions workflow. You can also trigger ingestion
        anytime with the <strong>Ingest Now</strong> button on the digest page.
      </p>

      <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
        <p className="text-sm text-foreground font-medium">Current schedule</p>
        <p className="text-sm text-muted">Daily at 5:00 AM CT (11:00 UTC)</p>

        <p className="text-xs text-muted">
          To change the schedule, update the cron expression in{' '}
          <code className="px-1 py-0.5 rounded bg-background text-foreground text-xs font-mono">.github/workflows/ingest.yml</code>{' '}
          and push to main. Use{' '}
          <a
            href="https://crontab.guru/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:opacity-80"
          >
            crontab.guru
          </a>{' '}
          to build cron expressions. You can also trigger the workflow manually from the GitHub Actions tab.
        </p>
      </div>
    </div>
  );
}
