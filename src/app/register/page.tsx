'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function RegisterForm() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') || '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, username, displayName, password, confirmPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        window.location.href = '/digest';
        return;
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Invite code"
          className="w-full px-4 py-3 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          autoFocus={!code}
        />
      </div>
      <div>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full px-4 py-3 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          autoComplete="username"
          autoFocus={!!code}
        />
      </div>
      <div>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Display name (optional)"
          className="w-full px-4 py-3 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-3 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          autoComplete="new-password"
        />
      </div>
      <div>
        <input
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          placeholder="Confirm password"
          className="w-full px-4 py-3 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
          autoComplete="new-password"
        />
      </div>

      {error && (
        <p className="text-danger text-sm text-center">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !code || !username || !password || !confirmPassword}
        className="w-full py-3 rounded-lg bg-accent text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light tracking-tight mb-2">ketchup</h1>
          <p className="text-muted text-sm">Create your account</p>
        </div>

        <Suspense fallback={<p className="text-muted text-sm text-center">Loading...</p>}>
          <RegisterForm />
        </Suspense>

        <p className="text-center text-sm text-muted mt-4">
          Already have an account?{' '}
          <Link href="/" className="text-accent hover:opacity-80">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
