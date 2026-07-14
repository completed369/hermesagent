'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

const TERMINAL_STATUSES = new Set(['PROMOTED', 'REJECTED', 'ARCHIVED']);

/**
 * Reject/archive/promote are founder-authority state changes (master spec
 * section 25) enforced server-side behind the `opportunity:manage`
 * permission and always written to the audit trail by the API - this
 * component only renders the buttons, it never assumes an action is
 * allowed just because it's visible.
 */
export function OpportunityActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  if (TERMINAL_STATUSES.has(status)) {
    return (
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
        This opportunity is {status.toLowerCase()} - no further actions available.
      </p>
    );
  }

  async function run(action: string, body?: unknown) {
    setLoading(action);
    setError(null);
    try {
      await apiFetch(`/opportunities/${id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      setShowReject(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <p className="vos-error">{error}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="vos-btn"
          disabled={loading !== null}
          onClick={() => run('promote')}
        >
          {loading === 'promote' ? 'Promoting...' : 'Promote to Venture Proposal'}
        </button>
        <button
          type="button"
          className="vos-btn"
          style={{
            background: 'var(--vos-bg-elevated)',
            color: 'var(--vos-text)',
            border: '1px solid var(--vos-border)',
          }}
          disabled={loading !== null}
          onClick={() => run('archive')}
        >
          {loading === 'archive' ? 'Archiving...' : 'Archive'}
        </button>
        <button
          type="button"
          className="vos-btn"
          style={{ background: 'var(--vos-danger)' }}
          disabled={loading !== null}
          onClick={() => setShowReject((v) => !v)}
        >
          Reject
        </button>
      </div>
      {showReject && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
          <textarea
            className="vos-input"
            rows={3}
            placeholder="Reason for rejection (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="vos-btn"
            style={{ background: 'var(--vos-danger)', width: 'fit-content' }}
            disabled={loading !== null || reason.trim().length === 0}
            onClick={() => run('reject', { reason })}
          >
            {loading === 'reject' ? 'Rejecting...' : 'Confirm rejection'}
          </button>
        </div>
      )}
    </div>
  );
}
