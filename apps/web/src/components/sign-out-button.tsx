'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

/**
 * The previous implementation was a <form action="/api/logout-redirect">
 * wrapping a plain <a href="/login">: an anchor tag inside a form does not
 * submit it, and /api/logout-redirect was never implemented as a route
 * handler either way. Clicking "Sign out" just navigated to /login without
 * ever calling the API, so the session was never revoked -- confirmed live:
 * /api/auth/me still returned 200 with a valid user after "logging out".
 *
 * This calls the real backend logout endpoint (same direct-to-API pattern
 * the login page already uses), which revokes the session server-side and
 * clears the cookie, then navigates to /login.
 */
export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort: still navigate to /login even if the request failed,
      // so the founder isn't stuck on a page that looks logged in.
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      style={{
        marginTop: 'auto',
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        fontSize: 13,
        color: 'var(--vos-text-muted)',
        textAlign: 'left',
        cursor: loading ? 'default' : 'pointer',
      }}
    >
      {loading ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
