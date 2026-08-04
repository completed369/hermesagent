'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Public signup requests a new customer workspace. The API deliberately
 * returns the same accepted response for new and existing identifiers and
 * creates no session; successful submissions therefore continue at login.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName, workspaceName }),
      });
      router.push('/login');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="vos-card"
        style={{ width: 380, display: 'grid', gap: 14 }}
        data-testid="register-form"
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Create your VentureOS workspace</h1>
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            14-day free trial -- full feature access, one venture. Upgrade any time in Settings.
          </p>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Workspace name
          <input
            className="vos-input"
            type="text"
            required
            placeholder="Acme Ventures"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Your name
          <input
            className="vos-input"
            type="text"
            required
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Email
          <input
            className="vos-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Password
          <input
            className="vos-input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <p className="vos-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="vos-btn" type="submit" disabled={loading}>
          {loading ? 'Creating workspace...' : 'Start free trial'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--vos-text-muted)' }}>
          Already have a workspace? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
