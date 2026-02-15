'use client';

import { useState, useEffect, useCallback } from 'react';

interface Preference {
  id: string;
  preference_text: string;
  confidence: number;
  derived_from_count: number;
  updated_at: string;
}

export default function PreferenceViewer() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    const res = await fetch('/api/preferences');
    if (res.ok) {
      setPreferences(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);

  async function deletePreference(id: string) {
    await fetch(`/api/preferences/${id}`, { method: 'DELETE' });
    fetchPreferences();
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        These preferences are automatically learned from your feedback. You can delete any that don&apos;t seem right.
      </p>

      {preferences.map(pref => (
        <div key={pref.id} className="p-4 rounded-lg bg-card border border-card-border">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm">{pref.preference_text}</p>
              <p className="text-xs text-muted mt-1">
                Confidence: {(pref.confidence * 100).toFixed(0)}% &middot;
                Based on {pref.derived_from_count} interactions
              </p>
            </div>
            <button
              onClick={() => deletePreference(pref.id)}
              className="text-xs text-danger hover:opacity-80 shrink-0"
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {preferences.length === 0 && (
        <p className="text-muted text-sm text-center py-4">
          No learned preferences yet. Keep interacting with articles and patterns will emerge.
        </p>
      )}
    </div>
  );
}
