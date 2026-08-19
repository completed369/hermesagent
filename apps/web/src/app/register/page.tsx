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
    <main className="vos-auth-shell">
      <section className="vos-auth-story">
        <Link href="/" className="vos-auth-brand">
          <span>V</span> VentureOS
        </Link>
        <p className="vos-auth-kicker">Start with a clear signal</p>
        <h1>
          Turn an idea into
          <br />
          an operating venture.
        </h1>
        <p>
          Create a secure workspace for your team, evidence, decisions and execution. Human approval
          stays built in.
        </p>
        <a href="https://progress.ventures.site" className="vos-auth-progress">
          See what is shipping <span>↗</span>
        </a>
      </section>
      <form onSubmit={handleSubmit} className="vos-card vos-auth-card" data-testid="register-form">
        <div>
          <p className="vos-auth-kicker">Open access</p>
          <h2>Create your workspace</h2>
          <p className="vos-auth-copy">
            For founders, builders, operators and venture teams. No founder-only account required.
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

        <p className="vos-auth-switch">
          Already have a workspace? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
