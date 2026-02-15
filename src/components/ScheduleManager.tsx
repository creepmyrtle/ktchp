'use client';

import { useState, useEffect, useCallback } from 'react';

export default function ScheduleManager() {
  const [times, setTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSchedule = useCallback(async () => {
    const res = await fetch('/api/settings/schedule');
    if (res.ok) {
      const data = await res.json();
      setTimes(data.times);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSchedule(); }, [fetchSchedule]);

  async function save() {
    setSaving(true);
    setSaved(false);
    const res = await fetch('/api/settings/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ times }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  function updateTime(index: number, value: string) {
    const updated = [...times];
    updated[index] = value;
    setTimes(updated);
  }

  function addTime() {
    setTimes([...times, '12:00']);
  }

  function removeTime(index: number) {
    if (times.length <= 1) return;
    setTimes(times.filter((_, i) => i !== index));
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Set the times when your digest should be generated. On Vercel, this updates the cron schedule. Locally, ingestion is manual via the Ingest Now button.
      </p>

      <div className="space-y-2">
        {times.map((time, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="time"
              value={time}
              onChange={e => updateTime(i, e.target.value)}
              className="px-3 py-2 rounded border border-card-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-sm"
            />
            <span className="text-xs text-muted">
              {formatTimeLabel(time)}
            </span>
            {times.length > 1 && (
              <button
                onClick={() => removeTime(i)}
                className="text-xs text-danger hover:opacity-80 ml-auto"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={addTime}
          className="text-sm text-accent hover:opacity-80"
        >
          + Add another time
        </button>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Schedule'}
        </button>
        {saved && <span className="text-sm text-success">Saved</span>}
      </div>
    </div>
  );
}

function formatTimeLabel(time: string): string {
  try {
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
  } catch {
    return time;
  }
}
