'use client';

import { useEffect, useState } from 'react';
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

type OpportunityComplianceAssessmentResponse = NonNullable<
  OpportunityComplianceStatus['assessment']
> & {
  auditEventId: string;
  createdAt: string;
};

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
  const [displayedCurrent, setDisplayedCurrent] = useState<OpportunityComplianceStatus | null>(
    current,
  );
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

  useEffect(() => setDisplayedCurrent(current), [current]);

  const canAssess = ASSESSABLE_STATUSES.has(status);
  const displayResult = !displayedCurrent
    ? 'NOT ASSESSED'
    : displayedCurrent.stateCurrent
      ? displayedCurrent.currentResult
      : 'STALE / BLOCKED';
  const resultClass =
    displayedCurrent?.stateCurrent && displayedCurrent.currentResult === 'PASS'
      ? 'vos-badge--ok'
      : displayedCurrent
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
      const assessment = await apiFetch<OpportunityComplianceAssessmentResponse>(
        `/opportunities/${id}/compliance-assessment`,
        {
          method: 'POST',
          body: JSON.stringify({
            declaredCategories,
            thirdPartyTrademarksPresent,
            copyrightedStockWithoutLicence,
            evidenceClaimIds,
          }),
        },
      );
      // The response is returned only after the assessment and its audit event
      // are persisted. Render that authoritative result directly rather than
      // depending on a second server refresh to make the mutation visible.
      setDisplayedCurrent({
        auditEventId: assessment.auditEventId,
        createdAt: assessment.createdAt,
        stateCurrent: true,
        currentResult: assessment.result,
        currentBlockers: assessment.blockers,
        assessment,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Compliance assessment failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        data-testid="compliance-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ display: 'grid', gap: 8 }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`vos-badge ${resultClass}`} data-testid="compliance-current-result">
            Gate 1: {displayResult}
          </span>
          {displayedCurrent?.assessment?.formulaVersion ? (
            <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
              {displayedCurrent.assessment.formulaVersion}
            </span>
          ) : null}
          {displayedCurrent?.assessment?.policyPackVersion ? (
            <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
              Policy pack {displayedCurrent.assessment.policyPackVersion}
            </span>
          ) : null}
        </div>

        {displayedCurrent?.auditEventId ? (
          <p
            data-testid="compliance-audit-id"
            style={{ margin: 0, fontSize: 12, color: 'var(--vos-text-muted)' }}
          >
            Audit evidence: {displayedCurrent.auditEventId}
          </p>
        ) : null}
      </div>

      {displayedCurrent?.currentBlockers.length ? (
        <div className="vos-error" data-testid="compliance-blockers" role="alert">
          <strong>Current blocker(s)</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {displayedCurrent.currentBlockers.map((blocker) => (
              <li key={`${blocker.code}:${blocker.reason}`}>{blocker.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {canAssess ? (
        <form
          data-testid="compliance-form"
          aria-busy={submitting}
          onSubmit={submitAssessment}
          style={{ display: 'grid', gap: 10, maxWidth: 720 }}
        >
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
            <p
              data-testid="compliance-error"
              className="vos-error"
              role="alert"
              style={{ margin: 0 }}
            >
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
            {submitting
              ? 'Assessing…'
              : displayedCurrent
                ? 'Re-run compliance assessment'
                : 'Run compliance assessment'}
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
