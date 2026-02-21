'use client';

import { useState, useEffect, useCallback } from 'react';

interface Exclusion {
  id: string;
  category: string;
  description: string | null;
}

export default function ExclusionManager() {
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const fetchExclusions = useCallback(async () => {
    const res = await fetch('/api/exclusions');
    if (res.ok) {
      setExclusions(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchExclusions(); }, [fetchExclusions]);

  async function addExclusion(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;

    const res = await fetch('/api/exclusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newCategory, description: newDescription || null }),
    });
    if (res.ok) {
      setNewCategory('');
      setNewDescription('');
      fetchExclusions();
    }
  }

  async function deleteExclusion(id: string) {
    await fetch(`/api/exclusions/${id}`, { method: 'DELETE' });
    fetchExclusions();
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted mb-3">
          Topics you don&apos;t want to see in your digest. Articles matching these topics will be
          penalized during scoring.
        </p>
      </div>

      <form onSubmit={addExclusion} className="flex flex-col gap-2 p-4 rounded-lg bg-card border border-card-border">
        <input
          type="text"
          value={newCategory}
          onChange={e => setNewCategory(e.target.value)}
          placeholder="Topic to exclude (e.g., Cryptocurrency)"
          className="px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
        />
        <input
          type="text"
          value={newDescription}
          onChange={e => setNewDescription(e.target.value)}
          placeholder="Description (optional)"
          className="px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
        />
        <button
          type="submit"
          disabled={!newCategory.trim()}
          className="self-end px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          Add Exclusion
        </button>
      </form>

      {exclusions.map(exclusion => (
        <div key={exclusion.id} className="p-4 rounded-lg bg-card border border-card-border flex items-start justify-between gap-2">
          <div className="flex-1">
            <h4 className="font-medium text-sm">{exclusion.category}</h4>
            {exclusion.description && (
              <p className="text-xs text-muted mt-0.5">{exclusion.description}</p>
            )}
          </div>
          <button
            onClick={() => deleteExclusion(exclusion.id)}
            className="text-xs text-danger hover:opacity-80 shrink-0"
          >
            Delete
          </button>
        </div>
      ))}

      {exclusions.length === 0 && (
        <p className="text-muted text-sm text-center py-4">No excluded topics yet.</p>
      )}
    </div>
  );
}
