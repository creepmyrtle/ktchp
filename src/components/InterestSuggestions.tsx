'use client';

import { useState, useEffect, useCallback } from 'react';

interface Suggestion {
  id: string;
  category: string;
  description: string | null;
  related_interests: string[];
  reasoning: string | null;
  confidence: number;
}

interface InterestSuggestionsProps {
  onAccepted?: () => void;
}

export default function InterestSuggestions({ onAccepted }: InterestSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      setSuggestions(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  async function acceptSuggestion(id: string) {
    setActioning(id);
    const res = await fetch(`/api/suggestions/${id}/accept`, { method: 'POST' });
    if (res.ok) {
      setSuggestions(prev => prev.filter(s => s.id !== id));
      onAccepted?.();
    }
    setActioning(null);
  }

  async function dismissSuggestion(id: string) {
    setActioning(id);
    const res = await fetch(`/api/suggestions/${id}/dismiss`, { method: 'POST' });
    if (res.ok) {
      setSuggestions(prev => prev.filter(s => s.id !== id));
    }
    setActioning(null);
  }

  if (loading || suggestions.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="text-xs text-muted mb-2 uppercase tracking-wide">
        Suggested Interests ({suggestions.length})
      </p>
      <div className="space-y-2">
        {suggestions.map(suggestion => (
          <div key={suggestion.id} className="p-4 rounded-lg bg-card border border-card-border">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="font-medium text-sm">{suggestion.category}</h4>
            </div>
            {suggestion.description && (
              <p className="text-xs text-muted mb-1">{suggestion.description}</p>
            )}
            {suggestion.related_interests.length > 0 && (
              <p className="text-xs text-muted mb-1">
                Related to: {suggestion.related_interests.join(', ')}
              </p>
            )}
            {suggestion.reasoning && (
              <p className="text-xs text-muted italic mb-2">&ldquo;{suggestion.reasoning}&rdquo;</p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => acceptSuggestion(suggestion.id)}
                disabled={actioning === suggestion.id}
                className="px-3 py-1 text-xs rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
              >
                Add to Interests
              </button>
              <button
                onClick={() => dismissSuggestion(suggestion.id)}
                disabled={actioning === suggestion.id}
                className="px-3 py-1 text-xs rounded border border-card-border text-muted hover:text-foreground disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
