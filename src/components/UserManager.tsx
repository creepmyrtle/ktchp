'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserInfo {
  id: string;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export default function UserManager() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      setUsers(await res.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !isActive }),
    });
    fetchUsers();
  }

  async function toggleAdmin(id: string, isAdmin: boolean) {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_admin: !isAdmin }),
    });
    fetchUsers();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    setConfirmDeleteId(null);
    fetchUsers();
  }

  if (loading) return <p className="text-muted text-sm">Loading...</p>;

  return (
    <div className="space-y-2">
      {users.map(user => (
        <div key={user.id} className={`p-3 rounded-lg bg-card border border-card-border flex items-center justify-between gap-2 ${!user.is_active ? 'opacity-60' : ''}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{user.display_name || user.username}</p>
              {user.is_admin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-light text-accent">admin</span>
              )}
              {!user.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-card-border text-muted">inactive</span>
              )}
            </div>
            <p className="text-xs text-muted">@{user.username}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => toggleAdmin(user.id, user.is_admin)}
              className="text-xs px-2 py-1 rounded bg-card-border text-muted hover:text-foreground"
            >
              {user.is_admin ? 'Remove admin' : 'Make admin'}
            </button>
            <button
              onClick={() => toggleActive(user.id, user.is_active)}
              className={`text-xs px-2 py-1 rounded ${user.is_active ? 'text-danger hover:opacity-80' : 'bg-accent-light text-accent'}`}
            >
              {user.is_active ? 'Deactivate' : 'Activate'}
            </button>
            {confirmDeleteId === user.id ? (
              <>
                <button
                  onClick={() => handleDelete(user.id)}
                  className="text-xs px-2 py-1 rounded bg-danger text-white"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-xs px-2 py-1 rounded text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(user.id)}
                className="text-xs text-danger hover:opacity-80"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      {users.length === 0 && (
        <p className="text-muted text-sm text-center py-4">No users found.</p>
      )}
    </div>
  );
}
