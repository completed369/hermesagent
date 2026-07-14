'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

const DECIDABLE_STATES = new Set(['PENDING']);
const REVOCABLE_STATES = new Set(['APPROVED', 'APPROVED_WITH_CONDITIONS']);

type Decision = 'APPROVE' | 'REJECT' | 'REQUEST_REVISION' | 'APPROVE_WITH_CONDITIONS' | 'REVOKE';

/**
 * The founder's decide UI. Every decision is server-enforced and re-checked
 * against the venture proposal's CURRENT version hash before being honored
 * (master spec section 14) -- this component never assumes a decision will
 * succeed just because the button was clickable; a 409 here means the
 * proposal changed since the request was raised and a fresh one is needed.
 */
export function ApprovalActions({ id, state }: { id: string; state: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [conditions, setConditions] = useState('');

  if (!DECIDABLE_STATES.has(state) && !REVOCABLE_STATES.has(state)) {
    return (
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
        This approval request is {state.toLowerCase().replaceAll('_', ' ')} -- no further decisions
        available.
      </p>
    );
  }

  async function decide(decision: Decision) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/approval-requests/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comment: comment || undefined,
          conditions: conditions
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Decision failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <p className="vos-error">{error}</p>}
      <textarea
        className="vos-input"
        rows={2}
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <input
        className="vos-input"
        placeholder="Conditions, comma-separated (used for Approve with Conditions / Request Revision)"
        value={conditions}
        onChange={(e) => setConditions(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {DECIDABLE_STATES.has(state) && (
          <>
            <button
              type="button"
              className="vos-btn"
              disabled={loading}
              onClick={() => decide('APPROVE')}
            >
              {loading ? 'Working...' : 'Approve'}
            </button>
            <button
              type="button"
              className="vos-btn"
              style={{
                background: 'var(--vos-bg-elevated)',
                color: 'var(--vos-text)',
                border: '1px solid var(--vos-border)',
              }}
              disabled={loading}
              onClick={() => decide('APPROVE_WITH_CONDITIONS')}
            >
              Approve with conditions
            </button>
            <button
              type="button"
              className="vos-btn"
              style={{
                background: 'var(--vos-bg-elevated)',
                color: 'var(--vos-text)',
                border: '1px solid var(--vos-border)',
              }}
              disabled={loading}
              onClick={() => decide('REQUEST_REVISION')}
            >
              Request revision
            </button>
            <button
              type="button"
              className="vos-btn"
              style={{ background: 'var(--vos-danger)' }}
              disabled={loading}
              onClick={() => decide('REJECT')}
            >
              Reject
            </button>
          </>
        )}
        {REVOCABLE_STATES.has(state) && (
          <button
            type="button"
            className="vos-btn"
            style={{ background: 'var(--vos-danger)' }}
            disabled={loading}
            onClick={() => decide('REVOKE')}
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
