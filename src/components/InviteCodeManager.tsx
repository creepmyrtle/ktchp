'use client';

import { useState, useEffect, useCallback } from 'react';

interface InviteCodeInfo {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export default function InviteCodeManager() {
  const [codes, setCodes] = useState<InviteCodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    const res = await fetch('/api/admin/invite-codes');
    if (res.ok) {
      setCodes(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  async function generateCode() {
    setCreating(true);
    const res = await fetch('/api/admin/invite-codes', { method: 'POST' });
    if (res.ok) {
      fetchCodes();
    }
    setCreating(false);
  }

  async function revokeCode(id: string) {
    await fetch(`/api/admin/invite-codes/${id}`, { method: 'DELETE' });
    fetchCodes();
  }

  function copyLink(code: string, id: string) {
    const url = `${window.location.origin}/register?code=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <button
        onClick={generateCode}
        disabled={creating}
        className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
      >
        {creating ? 'Generating...' : 'Generate Invite Code'}
      </button>

      <div className="space-y-2">
        {codes.map(code => (
          <div key={code.id} className={`p-3 rounded-lg bg-card border border-card-border flex items-center justify-between gap-2 ${code.used_by ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono">{code.code}</p>
              <p className="text-xs text-muted">
                {code.used_by
                  ? `Used ${code.used_at ? new Date(code.used_at).toLocaleDateString() : ''}`
                  : 'Available'
                }
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!code.used_by && (
                <>
                  <button
                    onClick={() => copyLink(code.code, code.id)}
                    className="text-xs px-2 py-1 rounded bg-accent-light text-accent"
                  >
                    {copiedId === code.id ? 'Copied!' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => revokeCode(code.id)}
                    className="text-xs text-danger hover:opacity-80"
                  >
                    Revoke
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {codes.length === 0 && (
          <p className="text-muted text-sm text-center py-4">No invite codes yet.</p>
        )}
      </div>
    </div>
  );
}
