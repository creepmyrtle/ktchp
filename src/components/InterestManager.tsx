'use client';

import { useState, useEffect, useCallback } from 'react';
import InterestSuggestions from './InterestSuggestions';

interface Interest {
  id: string;
  category: string;
  description: string | null;
  weight: number;
  active: boolean;
}

export default function InterestManager() {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategory, setNewCategory] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const fetchInterests = useCallback(async () => {
    const res = await fetch('/api/interests');
    if (res.ok) {
      setInterests(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchInterests(); }, [fetchInterests]);

  async function addInterest(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;

    const res = await fetch('/api/interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newCategory, description: newDescription || null }),
    });
    if (res.ok) {
      setNewCategory('');
      setNewDescription('');
      fetchInterests();
    }
  }

  async function updateInterest(id: string, updates: Partial<Interest>) {
    await fetch(`/api/interests/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    fetchInterests();
  }

  async function deleteInterest(id: string) {
    await fetch(`/api/interests/${id}`, { method: 'DELETE' });
    fetchInterests();
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <InterestSuggestions onAccepted={fetchInterests} />

      <form onSubmit={addInterest} className="flex flex-col gap-2 p-4 rounded-lg bg-card border border-card-border">
        <input
          type="text"
          value={newCategory}
          onChange={e => setNewCategory(e.target.value)}
          placeholder="Interest category (e.g., AI / LLMs)"
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
          Add Interest
        </button>
      </form>

      {[...interests].sort((a, b) => a.category.localeCompare(b.category)).map(interest => (
        <div key={interest.id} className="p-4 rounded-lg bg-card border border-card-border">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1">
              <h4 className="font-medium text-sm">{interest.category}</h4>
              {interest.description && (
                <p className="text-xs text-muted mt-0.5">{interest.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateInterest(interest.id, { active: !interest.active })}
                className={`text-xs px-2 py-1 rounded ${
                  interest.active ? 'bg-accent-light text-accent' : 'bg-card-border text-muted'
                }`}
              >
                {interest.active ? 'Active' : 'Inactive'}
              </button>
              <button
                onClick={() => deleteInterest(interest.id)}
                className="text-xs text-danger hover:opacity-80"
              >
                Delete
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted">Weight:</span>
            <div className="flex items-center gap-1">
              {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map(w => (
                <button
                  key={w}
                  onClick={() => updateInterest(interest.id, { weight: w })}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    interest.weight === w
                      ? 'bg-accent-light text-accent border-accent'
                      : 'border-card-border text-muted hover:text-foreground hover:border-border-hover'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}

      {interests.length === 0 && (
        <p className="text-muted text-sm text-center py-4">No interests yet. Add one above.</p>
      )}
    </div>
  );
}
