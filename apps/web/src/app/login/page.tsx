'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('founder@ventureos.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
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
        style={{ width: 360, display: 'grid', gap: 14 }}
        data-testid="login-form"
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>VentureOS</h1>
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Founder sign-in - human control, always.
          </p>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Email
          <input
            className="vos-input"
            type="email"
            required
            autoComplete="email"
            data-testid="login-email"
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
            autoComplete="current-password"
            data-testid="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <p className="vos-error" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}

        <button className="vos-btn" type="submit" disabled={loading} data-testid="login-submit">
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--vos-text-muted)' }}>
          Development login only. Credentials come from your local <code>.env</code>, seeded via{' '}
          <code>pnpm db:seed</code>.
        </p>
        <p style={{ fontSize: 12, color: 'var(--vos-text-muted)' }}>
          New here? <Link href="/register">Create a workspace</Link>
        </p>
      </form>
    </main>
  );
}
