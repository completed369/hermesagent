'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

interface InvitationPreview {
  workspaceName: string;
  roleKey: string;
  expiresAt: string;
}

export default function JoinWorkspacePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<InvitationPreview>(`/workspace-invitations/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Invite unavailable'));
  }, [token]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/workspace-invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password }),
      });
      router.push('/login?joined=1');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join this workspace.');
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
        <p className="vos-auth-kicker">Collaborative workspace</p>
        <h1>Join the operating room.</h1>
        <p>
          Work from the same evidence, decisions and audit trail—with access limited to your role.
        </p>
      </section>
      <form className="vos-card vos-auth-card" onSubmit={accept}>
        <div>
          <p className="vos-auth-kicker">Secure invitation</p>
          <h2>{invitation ? `Join ${invitation.workspaceName}` : 'Checking invitation…'}</h2>
          {invitation ? (
            <p className="vos-auth-copy">
              You’ll join as {invitation.roleKey.toLowerCase()}. This link is single-use.
            </p>
          ) : null}
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
          Your name
          <input
            className="vos-input"
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
          Create password
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
        <button className="vos-btn" type="submit" disabled={!invitation || loading}>
          {loading ? 'Joining…' : 'Join workspace'}
        </button>
        <p className="vos-auth-switch">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
