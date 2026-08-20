'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

interface OnboardingData {
  businessObjectives?: string;
  availableBudgetEur?: number;
  riskTolerance?: 'LOW' | 'MEDIUM' | 'HIGH';
  weeklyTimeHours?: number;
}

export default function OnboardingPage() {
  const [form, setForm] = useState<OnboardingData>({ riskTolerance: 'MEDIUM' });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    apiFetch<OnboardingData | null>('/onboarding')
      .then((data) => {
        if (data) setForm(data);
        setLoaded(true);
      })
      .catch((err) => {
        setLoaded(true);
        if (err instanceof ApiError && err.status === 403) {
          setAccessDenied(true);
          setError('Founder authority is required to view or edit onboarding.');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load onboarding');
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      await apiFetch('/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          preferredCategories: [],
          excludedCategories: [],
          targetRegions: ['EU', 'International'],
          preferredLanguages: ['en'],
          existingSkills: [],
          marketplacePreferences: ['etsy'],
          advertisingPreference: 'DISABLED',
        }),
      });
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Could not save onboarding');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Founder Onboarding</h1>
      <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 0 }}>
        Prepopulated with project defaults (master spec section 5) - edit and save.
      </p>

      {!loaded ? (
        <p role="status" aria-live="polite">
          Loading onboarding.
        </p>
      ) : null}
      {accessDenied ? (
        <p className="vos-error" role="alert">
          {error}
        </p>
      ) : null}

      {!accessDenied ? (
        <form
          onSubmit={handleSubmit}
          className="vos-card"
          style={{ marginTop: 16, display: 'grid', gap: 14, maxWidth: 480 }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Business objectives
            <textarea
              className="vos-input"
              rows={3}
              value={form.businessObjectives ?? ''}
              onChange={(e) => setForm({ ...form, businessObjectives: e.target.value })}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Available monthly budget (EUR)
            <input
              className="vos-input"
              type="number"
              min={0}
              value={form.availableBudgetEur ?? 100}
              onChange={(e) => setForm({ ...form, availableBudgetEur: Number(e.target.value) })}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Risk tolerance
            <select
              className="vos-input"
              value={form.riskTolerance}
              onChange={(e) =>
                setForm({
                  ...form,
                  riskTolerance: e.target.value as OnboardingData['riskTolerance'],
                })
              }
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Available weekly time (hours)
            <input
              className="vos-input"
              type="number"
              min={0}
              max={168}
              value={form.weeklyTimeHours ?? 10}
              onChange={(e) => setForm({ ...form, weeklyTimeHours: Number(e.target.value) })}
            />
          </label>

          {error ? (
            <p className="vos-error" role="alert">
              {error}
            </p>
          ) : null}

          <p role="status" aria-live="polite" style={{ margin: 0 }}>
            {status === 'saving'
              ? 'Saving onboarding.'
              : status === 'saved'
                ? 'Onboarding saved.'
                : ''}
          </p>

          <button className="vos-btn" type="submit" disabled={!loaded || status === 'saving'}>
            {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
