'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
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
    <main className="vos-auth-shell">
      <section className="vos-auth-story">
        <Link href="/" className="vos-auth-brand">
          <span>V</span> VentureOS
        </Link>
        <p className="vos-auth-kicker">Human-directed venture intelligence</p>
        <h1>
          One operating system.
          <br />
          Every venture signal.
        </h1>
        <p>
          Return to your workspace to coordinate research, approvals, products and growth with your
          team.
        </p>
        <a href="https://progress.ventures.site" className="vos-auth-progress">
          View platform progress <span>↗</span>
        </a>
      </section>
      <form onSubmit={handleSubmit} className="vos-card vos-auth-card" data-testid="login-form">
        <div>
          <p className="vos-auth-kicker">Welcome back</p>
          <h2>Sign in to your workspace</h2>
          <p className="vos-auth-copy">
            Access for founders, operators, partners and invited team members.
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

        <p className="vos-auth-switch">
          New to VentureOS? <Link href="/register">Create a workspace</Link>
        </p>
      </form>
    </main>
  );
}
