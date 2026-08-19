'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

const OPPORTUNITY_FACTORS = [
  ['demand', 'Demand'],
  ['trendStrength', 'Trend strength'],
  ['competitionAttractiveness', 'Competition attractiveness'],
  ['expectedMargin', 'Expected margin'],
  ['productDifferentiation', 'Product differentiation'],
  ['productionFeasibility', 'Production feasibility'],
  ['organicMarketingPotential', 'Organic marketing potential'],
  ['marketplacePolicyRisk', 'Marketplace policy attractiveness'],
  ['intellectualPropertyRisk', 'IP-risk attractiveness'],
  ['evidenceConfidence', 'Evidence confidence'],
  ['timeToLaunch', 'Time-to-launch attractiveness'],
] as const;

const PROFIT_FACTORS = [
  ['sampleSize', 'Sample size'],
  ['costCertainty', 'Cost certainty'],
  ['marketplaceFeeCertainty', 'Marketplace-fee certainty'],
  ['comparableProductQuality', 'Comparable-product quality'],
  ['forecastRangeWidth', 'Forecast-range confidence'],
  ['historicalModelAccuracy', 'Historical model accuracy'],
  ['channelMaturity', 'Channel maturity'],
  ['assumptionSensitivity', 'Assumption robustness'],
] as const;

type ScoreMap = Record<string, string>;

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

function scorePayload(entries: readonly (readonly [string, string])[], values: ScoreMap) {
  return Object.fromEntries(entries.map(([key]) => [key, Number(values[key])])) as Record<
    string,
    number
  >;
}

export default function NewOpportunityPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opportunityFactors, setOpportunityFactors] = useState<ScoreMap>({});
  const [profitFactors, setProfitFactors] = useState<ScoreMap>({});
  const [form, setForm] = useState({
    title: '',
    description: '',
    suggestedProductType: '',
    suggestedMarketplace: 'etsy',
    estimatedCostEur: '',
    estimatedRevenueEur: '',
    timeToLaunchDays: '',
    risks: '',
    persona: '',
    painPoints: '',
    buyingTriggers: '',
    channel: '',
    channelRationale: '',
    evidenceSourceName: '',
    evidenceSourceType: 'FOUNDER_PROVIDED',
    evidenceSourceIdentifier: '',
    evidenceRetrievedAt: '',
    evidenceFreshnessHours: '',
    evidenceCollectionMethod: 'FOUNDER_PROVIDED',
    evidenceExcerpt: '',
    evidenceRelevance: '',
    evidenceClaimType: 'UNKNOWN',
    evidenceStatement: '',
  });

  function updateField(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const evidenceRetrievedAt = new Date(form.evidenceRetrievedAt);
      if (!Number.isFinite(evidenceRetrievedAt.getTime())) {
        throw new Error('Evidence retrieval date is required.');
      }

      const payload = {
        title: form.title,
        description: form.description,
        ...(form.suggestedProductType.trim()
          ? { suggestedProductType: form.suggestedProductType.trim() }
          : {}),
        ...(form.suggestedMarketplace.trim()
          ? { suggestedMarketplace: form.suggestedMarketplace.trim() }
          : {}),
        ...(optionalNumber(form.estimatedCostEur) !== undefined
          ? { estimatedCostEur: optionalNumber(form.estimatedCostEur) }
          : {}),
        ...(optionalNumber(form.estimatedRevenueEur) !== undefined
          ? { estimatedRevenueEur: optionalNumber(form.estimatedRevenueEur) }
          : {}),
        ...(optionalNumber(form.timeToLaunchDays) !== undefined
          ? { timeToLaunchDays: optionalNumber(form.timeToLaunchDays) }
          : {}),
        risks: lines(form.risks),
        targetCustomer: {
          persona: form.persona,
          painPoints: lines(form.painPoints),
          buyingTriggers: lines(form.buyingTriggers),
        },
        channels: form.channel.trim()
          ? [
              {
                channel: form.channel.trim(),
                rationale: form.channelRationale,
                priority: 1,
              },
            ]
          : [],
        evidence: [
          {
            sourceName: form.evidenceSourceName,
            sourceType: form.evidenceSourceType,
            ...(form.evidenceSourceIdentifier.trim()
              ? { sourceIdentifier: form.evidenceSourceIdentifier.trim() }
              : {}),
            retrievedAt: evidenceRetrievedAt.toISOString(),
            freshnessRequirementHours: Number(form.evidenceFreshnessHours),
            collectionMethod: form.evidenceCollectionMethod,
            ...(form.evidenceExcerpt.trim() ? { originalExcerpt: form.evidenceExcerpt } : {}),
            relevanceScore: Number(form.evidenceRelevance),
            personalDataClassification: 'NONE',
            claimType: form.evidenceClaimType,
            statement: form.evidenceStatement,
          },
        ],
        opportunityFactors: scorePayload(OPPORTUNITY_FACTORS, opportunityFactors),
        profitConfidenceFactors: scorePayload(PROFIT_FACTORS, profitFactors),
      };

      const created = await apiFetch<{ id: string }>('/opportunities', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // This mutation creates the target route's complete server-rendered data.
      // Commit one full navigation instead of racing router.push() against a
      // refresh of the form route, which could leave a successfully created
      // opportunity stranded behind the still-visible form.
      window.location.assign(`/dashboard/opportunities/${created.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not create opportunity',
      );
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 980 }}>
      <div>
        <Link href="/dashboard/opportunities" style={{ color: 'var(--vos-accent)', fontSize: 13 }}>
          ← Opportunity Feed
        </Link>
        <h1 style={{ margin: '8px 0 0', fontSize: 24 }}>New opportunity</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Create a real, workspace-scoped candidate from founder-entered evidence. VentureOS derives
          evidence quality and freshness server-side; this form never accepts a final gate score.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 18 }}>
        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Opportunity and customer</h2>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Title
            <input
              data-testid="opportunity-title"
              className="vos-input"
              required
              minLength={3}
              maxLength={200}
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Problem / proposed solution
            <textarea
              data-testid="opportunity-description"
              className="vos-input"
              required
              minLength={20}
              rows={4}
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
            />
          </label>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Suggested product type
              <input
                className="vos-input"
                value={form.suggestedProductType}
                onChange={(event) => updateField('suggestedProductType', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Suggested marketplace
              <input
                className="vos-input"
                value={form.suggestedMarketplace}
                onChange={(event) => updateField('suggestedMarketplace', event.target.value)}
              />
            </label>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Estimated cost (EUR)
              <input
                className="vos-input"
                type="number"
                min={0}
                step="0.01"
                value={form.estimatedCostEur}
                onChange={(event) => updateField('estimatedCostEur', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Estimated revenue (EUR)
              <input
                className="vos-input"
                type="number"
                min={0}
                step="0.01"
                value={form.estimatedRevenueEur}
                onChange={(event) => updateField('estimatedRevenueEur', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Time to launch (days)
              <input
                className="vos-input"
                type="number"
                min={1}
                max={3650}
                value={form.timeToLaunchDays}
                onChange={(event) => updateField('timeToLaunchDays', event.target.value)}
              />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Target customer persona
            <textarea
              data-testid="opportunity-persona"
              className="vos-input"
              required
              minLength={3}
              rows={2}
              value={form.persona}
              onChange={(event) => updateField('persona', event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Customer pain points (one per line)
            <textarea
              data-testid="opportunity-pain-points"
              className="vos-input"
              required
              rows={3}
              value={form.painPoints}
              onChange={(event) => updateField('painPoints', event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Buying triggers (one per line, optional)
            <textarea
              className="vos-input"
              rows={2}
              value={form.buyingTriggers}
              onChange={(event) => updateField('buyingTriggers', event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Risks (one per line, optional)
            <textarea
              className="vos-input"
              rows={3}
              value={form.risks}
              onChange={(event) => updateField('risks', event.target.value)}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Initial channel (optional)
              <input
                className="vos-input"
                value={form.channel}
                onChange={(event) => updateField('channel', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Channel rationale
              <input
                className="vos-input"
                required={Boolean(form.channel.trim())}
                value={form.channelRationale}
                onChange={(event) => updateField('channelRationale', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Initial evidence</h2>
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
              Reliability and freshness are calculated by the server. Enter the source truthfully;
              do not upgrade an estimate or assumption to a verified fact.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Source name
              <input
                data-testid="evidence-source-name"
                className="vos-input"
                required
                value={form.evidenceSourceName}
                onChange={(event) => updateField('evidenceSourceName', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Source type
              <select
                data-testid="evidence-source-type"
                className="vos-input"
                value={form.evidenceSourceType}
                onChange={(event) => updateField('evidenceSourceType', event.target.value)}
              >
                <option value="FOUNDER_PROVIDED">Founder provided</option>
                <option value="OFFICIAL_API">Official API</option>
                <option value="PUBLIC_EXPORT">Public export</option>
                <option value="PERMITTED_BROWSER_RESEARCH">Permitted browser research</option>
                <option value="MANUAL_IMPORT">Manual import</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Source identifier / URL (optional)
            <input
              className="vos-input"
              value={form.evidenceSourceIdentifier}
              onChange={(event) => updateField('evidenceSourceIdentifier', event.target.value)}
            />
          </label>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Retrieved at
              <input
                data-testid="evidence-retrieved-at"
                className="vos-input"
                type="datetime-local"
                required
                value={form.evidenceRetrievedAt}
                onChange={(event) => updateField('evidenceRetrievedAt', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Freshness requirement (hours)
              <input
                data-testid="evidence-freshness-hours"
                className="vos-input"
                type="number"
                min={1}
                max={87600}
                required
                value={form.evidenceFreshnessHours}
                onChange={(event) => updateField('evidenceFreshnessHours', event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Relevance (0-100)
              <input
                data-testid="evidence-relevance"
                className="vos-input"
                type="number"
                min={0}
                max={100}
                required
                value={form.evidenceRelevance}
                onChange={(event) => updateField('evidenceRelevance', event.target.value)}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Collection method
              <select
                className="vos-input"
                value={form.evidenceCollectionMethod}
                onChange={(event) => updateField('evidenceCollectionMethod', event.target.value)}
              >
                <option value="FOUNDER_PROVIDED">Founder provided</option>
                <option value="MANUAL_IMPORT">Manual import</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              Claim classification
              <select
                data-testid="evidence-claim-type"
                className="vos-input"
                value={form.evidenceClaimType}
                onChange={(event) => updateField('evidenceClaimType', event.target.value)}
              >
                <option value="UNKNOWN">Unknown / unverified</option>
                <option value="VERIFIED_FACT">Verified fact</option>
                <option value="EXTERNAL_ESTIMATE">External estimate</option>
                <option value="FOUNDER_PROVIDED_FACT">Founder-provided fact</option>
                <option value="SYSTEM_CALCULATED_VALUE">System-calculated value</option>
                <option value="AGENT_ASSUMPTION">Agent assumption</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Evidence excerpt (optional)
            <textarea
              className="vos-input"
              rows={3}
              value={form.evidenceExcerpt}
              onChange={(event) => updateField('evidenceExcerpt', event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            Material claim
            <textarea
              data-testid="evidence-statement"
              className="vos-input"
              required
              rows={3}
              value={form.evidenceStatement}
              onChange={(event) => updateField('evidenceStatement', event.target.value)}
            />
          </label>
        </section>

        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Opportunity factors</h2>
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
              Founder-entered normalized factor inputs, 0-100. Final Opportunity Score is always
              calculated by the scoring engine.
            </p>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}
          >
            {OPPORTUNITY_FACTORS.map(([key, label]) => (
              <label key={key} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                {label}
                <input
                  data-testid={`opportunity-factor-${key}`}
                  className="vos-input"
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={opportunityFactors[key] ?? ''}
                  onChange={(event) =>
                    setOpportunityFactors((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section className="vos-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Profit-confidence factors</h2>
            <p style={{ color: 'var(--vos-text-muted)', fontSize: 12, margin: '4px 0 0' }}>
              Enter the non-evidence factors only. Evidence quality and data freshness are derived
              from the evidence record above and cannot be overridden here.
            </p>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}
          >
            {PROFIT_FACTORS.map(([key, label]) => (
              <label key={key} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                {label}
                <input
                  data-testid={`profit-factor-${key}`}
                  className="vos-input"
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={profitFactors[key] ?? ''}
                  onChange={(event) =>
                    setProfitFactors((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </section>

        {error ? (
          <p data-testid="opportunity-create-error" className="vos-error" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            data-testid="opportunity-create-submit"
            className="vos-btn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create opportunity'}
          </button>
          <span style={{ color: 'var(--vos-text-muted)', fontSize: 12 }}>
            Creation records evidence, scores and an audit event atomically.
          </span>
        </div>
      </form>
    </div>
  );
}
