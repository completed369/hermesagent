'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Creates a new Experiment with a fixed, sensible default shape (a Control
 * and a Variant B, with the Gate 5/6 commercial and support-load metrics
 * declared up front -- never invented after the fact to justify a result).
 */
export function CreateExperimentAction({ ventureProposalId }: { ventureProposalId: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name || !hypothesis) {
      setError('Name and hypothesis are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/finance/ventures/${ventureProposalId}/experiments`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          hypothesis,
          variants: [
            { name: 'Control', isControl: true },
            { name: 'Variant B', isControl: false },
          ],
          metrics: [
            { name: 'REVENUE_EUR', unit: 'EUR' },
            { name: 'CONVERSION_RATE', unit: '%' },
            { name: 'SUPPORT_CONTACTS', unit: 'count' },
            { name: 'SUPPORT_MINUTES', unit: 'minutes' },
            { name: 'QUALITY_INCIDENTS', unit: 'count' },
          ],
        }),
      });
      setName('');
      setHypothesis('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create experiment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {error && <p className="vos-error">{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Experiment name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 200 }}
        />
        <input
          type="text"
          placeholder="Hypothesis"
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          style={{ width: 260 }}
        />
        <button type="button" className="vos-btn" disabled={loading} onClick={submit}>
          {loading ? 'Creating...' : 'Create experiment (Control vs. Variant B)'}
        </button>
      </div>
    </div>
  );
}

interface Variant {
  id: string;
  name: string;
}
interface Metric {
  id: string;
  name: string;
}

type EvidenceMode = 'MOCK' | 'REAL';
type ObservationSourceType =
  | 'MARKETPLACE_EXPORT'
  | 'CUSTOMER_SUPPORT'
  | 'FOUNDER_OBSERVED'
  | 'MANUAL_IMPORT'
  | 'SYNTHETIC';

export function ExperimentPanelActions({
  experimentId,
  status,
  variants,
  metrics,
}: {
  experimentId: string;
  status: string;
  variants: Variant[];
  metrics: Metric[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>('MOCK');
  const [sourceType, setSourceType] = useState<ObservationSourceType>('SYNTHETIC');
  const [sourceRef, setSourceRef] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [decision, setDecision] = useState<'SCALE' | 'KILL' | 'ITERATE' | 'HOLD'>('ITERATE');
  const [rationale, setRationale] = useState('');
  const [approvalRequestId, setApprovalRequestId] = useState('');
  const [lastApprovalRequestId, setLastApprovalRequestId] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }

  const realEvidenceIncomplete =
    evidenceMode === 'REAL' && (!sourceRef.trim() || !observedAt || sourceType === 'SYNTHETIC');

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
      {error && <p className="vos-error">{error}</p>}

      {status === 'DRAFT' && (
        <button
          type="button"
          className="vos-btn"
          disabled={loading}
          onClick={() =>
            run(() => apiFetch(`/finance/experiments/${experimentId}/start`, { method: 'POST' }))
          }
        >
          {loading ? 'Starting...' : 'Start experiment'}
        </button>
      )}

      {(status === 'RUNNING' || status === 'COMPLETED') && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                data-testid="experiment-result-variant"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <select
                data-testid="experiment-result-metric"
                value={metricId}
                onChange={(e) => setMetricId(e.target.value)}
              >
                {metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                data-testid="experiment-result-value"
                type="number"
                step="0.0001"
                placeholder="Value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ width: 100 }}
              />
              <select
                data-testid="experiment-evidence-mode"
                value={evidenceMode}
                onChange={(e) => {
                  const next = e.target.value as EvidenceMode;
                  setEvidenceMode(next);
                  if (next === 'MOCK') {
                    setSourceType('SYNTHETIC');
                    setSourceRef('');
                    setObservedAt('');
                  } else if (sourceType === 'SYNTHETIC') {
                    setSourceType('FOUNDER_OBSERVED');
                  }
                }}
              >
                <option value="MOCK">MOCK / mechanical</option>
                <option value="REAL">REAL commercial evidence</option>
              </select>
            </div>

            {evidenceMode === 'REAL' ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  data-testid="experiment-source-type"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as ObservationSourceType)}
                >
                  <option value="MARKETPLACE_EXPORT">Marketplace export</option>
                  <option value="CUSTOMER_SUPPORT">Customer support</option>
                  <option value="FOUNDER_OBSERVED">Founder observed</option>
                  <option value="MANUAL_IMPORT">Manual import</option>
                </select>
                <input
                  data-testid="experiment-source-ref"
                  type="text"
                  placeholder="Evidence/source reference"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  style={{ width: 240 }}
                />
                <input
                  data-testid="experiment-observed-at"
                  type="datetime-local"
                  aria-label="Observed at"
                  value={observedAt}
                  onChange={(e) => setObservedAt(e.target.value)}
                />
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vos-text-muted)' }}>
                MOCK results prove workflow mechanics only and cannot satisfy genuine Gate 5/6
                commercial evidence.
              </p>
            )}

            <button
              data-testid="experiment-record-result"
              type="button"
              className="vos-btn"
              disabled={loading || !value || realEvidenceIncomplete}
              onClick={() =>
                run(() =>
                  apiFetch(`/finance/experiments/${experimentId}/results`, {
                    method: 'POST',
                    body: JSON.stringify({
                      experimentVariantId: variantId,
                      experimentMetricId: metricId,
                      value: Number(value),
                      evidenceMode,
                      sourceType,
                      sourceRef: evidenceMode === 'REAL' ? sourceRef.trim() : undefined,
                      observedAt:
                        evidenceMode === 'REAL' ? new Date(observedAt).toISOString() : undefined,
                    }),
                  }).then(() => {
                    setValue('');
                    if (evidenceMode === 'REAL') {
                      setSourceRef('');
                      setObservedAt('');
                    }
                  }),
                )
              }
              style={{ width: 'fit-content' }}
            >
              Record result
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="vos-btn"
              disabled={loading}
              onClick={() =>
                run(async () => {
                  const result = await apiFetch<{ approvalRequestId: string }>(
                    `/finance/experiments/${experimentId}/request-scale-approval`,
                    { method: 'POST' },
                  );
                  setLastApprovalRequestId(result.approvalRequestId);
                })
              }
            >
              Request Gate 6 scale-decision approval
            </button>
            {lastApprovalRequestId && (
              <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
                Approval request{' '}
                <span style={{ fontFamily: 'monospace' }}>{lastApprovalRequestId}</span> created --{' '}
                <Link href="/dashboard/approvals" style={{ color: 'var(--vos-accent)' }}>
                  decide it in the Approval Centre →
                </Link>
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
            >
              <option value="SCALE">SCALE (requires an approved Gate 6 request)</option>
              <option value="KILL">KILL</option>
              <option value="ITERATE">ITERATE</option>
              <option value="HOLD">HOLD</option>
            </select>
            <input
              type="text"
              placeholder="Rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              style={{ width: 220 }}
            />
            {decision === 'SCALE' && (
              <input
                type="text"
                placeholder="Approved approvalRequestId"
                value={approvalRequestId}
                onChange={(e) => setApprovalRequestId(e.target.value)}
                style={{ width: 220, fontFamily: 'monospace', fontSize: 12 }}
              />
            )}
            <button
              type="button"
              className="vos-btn"
              disabled={loading || !rationale}
              onClick={() =>
                run(() =>
                  apiFetch(`/finance/experiments/${experimentId}/decide`, {
                    method: 'POST',
                    body: JSON.stringify({
                      decision,
                      rationale,
                      approvalRequestId: decision === 'SCALE' ? approvalRequestId : undefined,
                    }),
                  }),
                )
              }
            >
              Record decision
            </button>
          </div>
        </>
      )}

      {status === 'DECIDED' && (
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          This experiment has already been decided.
        </p>
      )}
    </div>
  );
}
