'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

const EXPENSE_CATEGORIES = [
  'AI_GENERATION',
  'MARKETPLACE_FEE',
  'RESEARCH',
  'ADVERTISING',
  'OVERHEAD',
  'OTHER',
];

/**
 * Generates a new FinancialForecast for this venture via
 * @ventureos/finance-engine's calculateBreakEven/calculateScenarios (never
 * re-implemented client-side) -- persists a new FinancialForecast + 3
 * FinancialScenario rows every time, never overwritten in place.
 */
export function GenerateForecastAction({ ventureProposalId }: { ventureProposalId: string }) {
  const router = useRouter();
  const [baseUnitsSold, setBaseUnitsSold] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/finance/ventures/${ventureProposalId}/forecast`, {
        method: 'POST',
        body: JSON.stringify({ baseUnitsSold: Number(baseUnitsSold) }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate forecast');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {error && <p className="vos-error">{error}</p>}
      <label style={{ fontSize: 13 }}>
        Base units sold:{' '}
        <input
          type="number"
          min={0}
          value={baseUnitsSold}
          onChange={(e) => setBaseUnitsSold(e.target.value)}
          style={{ width: 80 }}
        />
      </label>
      <button type="button" className="vos-btn" disabled={loading} onClick={submit}>
        {loading ? 'Generating...' : 'Generate forecast'}
      </button>
    </div>
  );
}

export function RecordExpenseAction({ ventureProposalId }: { ventureProposalId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amountEur, setAmountEur] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!amountEur || !description) {
      setError('Amount and description are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/finance/ventures/${ventureProposalId}/expenses`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          amountEur: Number(amountEur),
          description,
          incurredAt: new Date().toISOString(),
        }),
      });
      setAmountEur('');
      setDescription('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record expense');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {error && <p className="vos-error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          placeholder="Amount EUR"
          value={amountEur}
          onChange={(e) => setAmountEur(e.target.value)}
          style={{ width: 110 }}
        />
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ width: 220 }}
        />
        <button type="button" className="vos-btn" disabled={loading} onClick={submit}>
          {loading ? 'Recording...' : 'Record expense'}
        </button>
      </div>
    </div>
  );
}

export function RecordRevenueAction({ ventureProposalId }: { ventureProposalId: string }) {
  const router = useRouter();
  const [unitsSold, setUnitsSold] = useState('1');
  const [grossRevenueEur, setGrossRevenueEur] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!grossRevenueEur) {
      setError('Gross revenue is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/finance/ventures/${ventureProposalId}/revenue`, {
        method: 'POST',
        body: JSON.stringify({
          unitsSold: Number(unitsSold),
          grossRevenueEur: Number(grossRevenueEur),
          occurredAt: new Date().toISOString(),
        }),
      });
      setGrossRevenueEur('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record revenue');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {error && <p className="vos-error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="number"
          min={0}
          placeholder="Units sold"
          value={unitsSold}
          onChange={(e) => setUnitsSold(e.target.value)}
          style={{ width: 100 }}
        />
        <input
          type="number"
          step="0.01"
          placeholder="Gross revenue EUR"
          value={grossRevenueEur}
          onChange={(e) => setGrossRevenueEur(e.target.value)}
          style={{ width: 150 }}
        />
        <button type="button" className="vos-btn" disabled={loading} onClick={submit}>
          {loading ? 'Recording...' : 'Record sale (manual)'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
        Manual entry -- Phase 6&apos;s marketplace pilot is mock-only (no real Etsy account
        connected), so there is no live sales feed to sync from yet.
      </p>
    </div>
  );
}
