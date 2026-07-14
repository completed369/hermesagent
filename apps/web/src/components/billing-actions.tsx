'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

const PLAN_KEYS = ['TRIAL', 'STARTER', 'GROWTH', 'AGENCY'];

/** Changes the workspace's plan via @ventureos/billing's changePlan --
 * downgrades never delete existing data, they only block *new* usage over
 * the new plan's limits going forward (see docs/DECISIONS.md). */
export function ChangePlanAction({ currentPlanKey }: { currentPlanKey: string }) {
  const router = useRouter();
  const [planKey, setPlanKey] = useState(currentPlanKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/billing/change-plan', {
        method: 'POST',
        body: JSON.stringify({ planKey }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change plan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {error && <p className="vos-error">{error}</p>}
      <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
        {PLAN_KEYS.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <button onClick={submit} disabled={loading || planKey === currentPlanKey}>
        {loading ? 'Changing...' : 'Change plan'}
      </button>
    </div>
  );
}

export function CancelSubscriptionAction({ status }: { status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(status === 'CANCELED' ? '/billing/reactivate' : '/billing/cancel', {
        method: 'POST',
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update subscription');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <p className="vos-error">{error}</p>}
      <button onClick={submit} disabled={loading}>
        {loading
          ? 'Working...'
          : status === 'CANCELED'
            ? 'Reactivate subscription'
            : 'Cancel subscription'}
      </button>
    </div>
  );
}

/** Issues a new license key for a self-hosted/exportable install (Phase 8
 * deliverable #6). Purely additive -- existing keys stay valid. */
export function IssueLicenseKeyAction() {
  const router = useRouter();
  const [expiresInDays, setExpiresInDays] = useState('365');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/billing/license-keys', {
        method: 'POST',
        body: JSON.stringify({ expiresInDays: expiresInDays ? Number(expiresInDays) : undefined }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to issue license key');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {error && <p className="vos-error">{error}</p>}
      <label style={{ fontSize: 13 }}>
        Expires in days:{' '}
        <input
          type="number"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          style={{ width: 80 }}
        />
      </label>
      <button onClick={submit} disabled={loading}>
        {loading ? 'Issuing...' : 'Issue license key'}
      </button>
    </div>
  );
}

export function RevokeLicenseKeyAction({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/billing/license-keys/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke license key');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span>
      {error && <span className="vos-error">{error}</span>}
      <button onClick={submit} disabled={loading}>
        {loading ? 'Revoking...' : 'Revoke'}
      </button>
    </span>
  );
}
