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
  const [previewState, setPreviewState] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  );
  const [accepting, setAccepting] = useState(false);
  const [status, setStatus] = useState('Checking this invitation.');

  useEffect(() => {
    let active = true;
    setInvitation(null);
    setError(null);
    setPreviewState('checking');
    setStatus('Checking this invitation.');
    apiFetch<InvitationPreview>(`/workspace-invitations/${encodeURIComponent(token)}`)
      .then((preview) => {
        if (!active) return;
        setInvitation(preview);
        setPreviewState('ready');
        setStatus(`Invitation verified for ${preview.workspaceName}.`);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : 'Invite unavailable');
        setPreviewState('unavailable');
        setStatus('');
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (!invitation || accepting) return;
    setAccepting(true);
    setError(null);
    setStatus(`Joining ${invitation.workspaceName}.`);
    try {
      await apiFetch(`/workspace-invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ displayName, email, password }),
      });
      setStatus('Workspace joined. Redirecting to sign in.');
      router.push('/login?joined=1');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join this workspace.');
      setStatus('');
    } finally {
      setAccepting(false);
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
      <form
        className="vos-card vos-auth-card vos-join-card"
        onSubmit={accept}
        aria-busy={previewState === 'checking' || accepting}
      >
        <p className="vos-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {status}
        </p>
        <div>
          <p className="vos-auth-kicker">Secure invitation</p>
          <h2>
            {invitation
              ? `Join ${invitation.workspaceName}`
              : previewState === 'checking'
                ? 'Checking invitation…'
                : 'Invitation unavailable'}
          </h2>
          {invitation ? (
            <p className="vos-auth-copy">
              You’ll join as {invitation.roleKey.toLowerCase()}. This link is single-use.
            </p>
          ) : null}
        </div>
        {previewState === 'checking' ? (
          <p className="vos-auth-copy">Verifying that this single-use link is still active…</p>
        ) : null}
        {error ? (
          <p className="vos-error" role="alert">
            {error}
          </p>
        ) : null}
        {invitation ? (
          <>
            <fieldset className="vos-join-fields" disabled={accepting}>
              <label>
                Your name
                <input
                  className="vos-input"
                  required
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  className="vos-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Create password
                <input
                  className="vos-input"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="vos-btn" type="submit">
                {accepting ? 'Joining…' : 'Join workspace'}
              </button>
            </fieldset>
            <p className="vos-auth-switch vos-join-account-note">
              This invitation creates a new workspace account. If this email is already registered,
              ask the founder to invite a different address.
            </p>
          </>
        ) : null}
      </form>
    </main>
  );
}
