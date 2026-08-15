'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

export interface OpportunityComplianceStatus {
  auditEventId: string;
  createdAt: string;
  stateCurrent: boolean;
  currentResult: 'PASS' | 'BLOCKED';
  currentBlockers: Array<{ code: string; reason: string }>;
  assessment: {
    formulaVersion: string;
    result: 'PASS' | 'BLOCKED';
    hasCriticalBlocker: boolean;
    blockers: Array<{ code: string; reason: string }>;
    policyPackVersion: string | null;
    declarations: {
      declaredCategories: string[];
      thirdPartyTrademarksPresent: boolean;
      copyrightedStockWithoutLicence: boolean;
    };
  } | null;
}

const ASSESSABLE_STATUSES = new Set(['NEW', 'UNDER_REVIEW']);

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function OpportunityComplianceActions({
  id,
  status,
  evidenceClaimIds,
  current,
}: {
  id: string;
  status: string;
  evidenceClaimIds: string[];
  current: OpportunityComplianceStatus | null;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(
    current?.assessment?.declarations.declaredCategories.join('\n') ?? '',
  );
  const [thirdPartyTrademarksPresent, setThirdPartyTrademarksPresent] = useState(
    current?.assessment?.declarations.thirdPartyTrademarksPresent ?? false,
  );
  const [copyrightedStockWithoutLicence, setCopyrightedStockWithoutLicence] = useState(
    current?.assessment?.declarations.copyrightedStockWithoutLicence ?? false,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAssess = ASSESSABLE_STATUSES.has(status);
  const displayResult = !current
    ? 'NOT ASSESSED'
    : current.stateCurrent
      ? current.currentResult
      : 'STALE / BLOCKED';
  const resultClass = current?.stateCurrent && current.currentResult === 'PASS'
    ? 'vos-badge--ok'
    : current
      ? 'vos-badge--danger'
      : 'vos-badge--mock';

  async function submitAssessment(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const declaredCategories = lines(categories);
    if (declaredCategories.length === 0) {
      setError('Enter at least one truthful product/category declaration.');
      return;
    }
    if (evidenceClaimIds.length === 0) {
      setError('At least one linked evidence claim is required before compliance assessment.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/opportunities/${id}/compliance-assessment`, {
        method: 'POST',
        body: JSON.stringify({
          declaredCategories,
          thirdPartyTrademarksPresent,
          copyrightedStockWithoutLicence,
          evidenceClaimIds,
        }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Compliance assessment failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`vos-badge ${resultClass}`} data-testid="compliance-current-result">
          Gate 1: {displayResult}
        </span>
        {current?.assessment?.formulaVersion ? (
          <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
            {current.assessment.formulaVersion}
          </span>
        ) : null}
        {current?.assessment?.policyPackVersion ? (
          <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
            Policy pack {current.assessment.policyPackVersion}
          </span>
        ) : null}
      </div>

      {current?.auditEventId ? (
        <p data-testid="compliance-audit-id" style={{ margin: 0, fontSize: 12, color: 'var(--vos-text-muted)' }}>
          Audit evidence: {current.auditEventId}
        </p>
      ) : null}

      {current?.currentBlockers.length ? (
        <div className="vos-error" data-testid="compliance-blockers">
          <strong>Current blocker(s)</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {current.currentBlockers.map((blocker) => (
              <li key={`${blocker.code}:${blocker.reason}`}>{blocker.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {canAssess ? (
        <form onSubmit={submitAssessment} style={{ display: 'grid', gap: 10, maxWidth: 720 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Product/category declarations (one per line)
            <textarea
              data-testid="compliance-categories"
              className="vos-input"
              rows={3}
              required
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
              placeholder="digital planning templates"
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input
              data-testid="compliance-trademarks"
              type="checkbox"
              checked={thirdPartyTrademarksPresent}
              onChange={(event) => setThirdPartyTrademarksPresent(event.target.checked)}
            />
            This product uses third-party trademarks.
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input
              data-testid="compliance-unlicensed-stock"
              type="checkbox"
              checked={copyrightedStockWithoutLicence}
              onChange={(event) => setCopyrightedStockWithoutLicence(event.target.checked)}
            />
            This product uses copyrighted stock imagery/content without a licence.
          </label>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--vos-text-muted)' }}>
            VentureOS evaluates these explicit declarations against the current marketplace policy
            pack and this opportunity&apos;s linked evidence. A missing, stale or blocked assessment
            cannot authorize Stage-6 promotion.
          </p>
          {error ? (
            <p data-testid="compliance-error" className="vos-error" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
          <button
            data-testid="compliance-submit"
            className="vos-btn"
            type="submit"
            disabled={submitting}
            style={{ width: 'fit-content' }}
          >
            {submitting ? 'Assessing…' : current ? 'Re-run compliance assessment' : 'Run compliance assessment'}
          </button>
        </form>
      ) : (
        <p style={{ margin: 0, color: 'var(--vos-text-muted)', fontSize: 13 }}>
          Compliance declarations are frozen after promotion or a terminal decision.
        </p>
      )}
    </div>
  );
}
