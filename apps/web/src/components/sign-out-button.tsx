'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setLoading(true);
    setError(null);

    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch {
      // Fail closed: do not make the UI look logged out while a valid
      // server-side session may still exist.
      setError('Sign out failed. Your session is still active. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        style={{
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
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--vos-danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
