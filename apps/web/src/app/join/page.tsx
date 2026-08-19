'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

interface InvitationPreview {
  workspaceName: string;
  roleKey: string;
  expiresAt: string;
}

export default function JoinWorkspacePage() {
  const router = useRouter();
  const consumedFragmentToken = useRef<string | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(null);
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
    if (consumedFragmentToken.current === undefined) {
      const hashParameters = new URLSearchParams(window.location.hash.slice(1));
      consumedFragmentToken.current = hashParameters.get('token');
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const invitationToken = consumedFragmentToken.current;
    setInvitation(null);
    setError(null);
    setPreviewState('checking');
    setStatus('Checking this invitation.');
    if (!invitationToken) {
      setError('Invitation token is missing. Ask the founder for a new link.');
      setPreviewState('unavailable');
      setStatus('');
      return () => {
        active = false;
      };
    }
    setToken(invitationToken);
    apiFetch<InvitationPreview>('/workspace-invitations/preview', {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ token: invitationToken }),
    })
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
  }, []);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (!invitation || !token || accepting) return;
    setAccepting(true);
    setError(null);
    setStatus(`Joining ${invitation.workspaceName}.`);
    try {
      await apiFetch('/workspace-invitations/accept', {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ token, displayName, email, password }),
      });
      setStatus('Access request received. Redirecting to sign in.');
      router.push('/login');
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
                {accepting ? 'Sending…' : 'Request workspace access'}
              </button>
            </fieldset>
            <p className="vos-auth-switch vos-join-account-note">
              For privacy, VentureOS gives the same result whether an account already exists. Use an
              email you control and contact the founder if access does not appear.
            </p>
          </>
        ) : null}
      </form>
    </main>
  );
}
