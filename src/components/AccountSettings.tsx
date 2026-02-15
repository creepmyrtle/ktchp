'use client';

import { useState, useEffect } from 'react';

export default function AccountSettings() {
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/account')
      .then(res => res.json())
      .then(data => {
        if (data.display_name) setDisplayName(data.display_name);
      });
  }, []);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      });

      if (res.ok) {
        setMessage('Display name updated');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });

      if (res.ok) {
        setMessage('Password updated');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className="text-sm text-accent text-center">{message}</p>
      )}
      {error && (
        <p className="text-sm text-danger text-center">{error}</p>
      )}

      <form onSubmit={handleUpdateProfile} className="p-4 rounded-lg bg-card border border-card-border space-y-3">
        <p className="text-sm font-medium">Display Name</p>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Display name"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          Update
        </button>
      </form>

      <form onSubmit={handleChangePassword} className="p-4 rounded-lg bg-card border border-card-border space-y-3">
        <p className="text-sm font-medium">Change Password</p>
        <input
          type="password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          autoComplete="current-password"
        />
        <input
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder="New password"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          className="w-full px-3 py-2 rounded border border-card-border bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="px-4 py-2 rounded bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          Change Password
        </button>
      </form>
    </div>
  );
}
