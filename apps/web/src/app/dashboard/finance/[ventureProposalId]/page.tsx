import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import {
  GenerateForecastAction,
  RecordExpenseAction,
  RecordRevenueAction,
} from '@/components/finance-actions';
import { CreateExperimentAction, ExperimentPanelActions } from '@/components/experiment-actions';

interface FinancialAssumption {
  id: string;
  productPriceEur: string;
  marketplaceFeeRate: string;
  paymentProcessingFeeRate: string;
  aiGenerationCostEur: string;
  monthlyOverheadAllocationEur: string;
  targetContributionMarginRate: string;
}
interface FinancialScenario {
  id: string;
  scenario: 'LOW' | 'BASE' | 'HIGH';
  unitsSold: number;
  grossRevenueEur: string;
  netRevenueEur: string;
  grossProfitEur: string;
  netProfitEur: string;
}
interface FinancialForecast {
  id: string;
  baseUnitsSold: number;
  breakEvenUnits: number | null;
  breakEvenRevenueEur: string | null;
  fixedCostsEur: string;
  scenarios: FinancialScenario[];
}
interface ForecastVsActual {
  forecastNetRevenueEur: number;
  actualNetRevenueEur: number;
  actualUnitsSold: number;
  forecastErrorEur: number;
  forecastErrorRate: number | null;
}
interface Expense {
  id: string;
  category: string;
  amountEur: string;
  description: string;
  incurredAt: string;
}
interface RevenueEntry {
  id: string;
  unitsSold: number;
  grossRevenueEur: string;
  netRevenueEur: string;
  occurredAt: string;
}
interface ExperimentVariant {
  id: string;
  name: string;
  isControl: boolean;
}
interface ExperimentMetric {
  id: string;
  name: string;
}
interface ExperimentSummary {
  id: string;
  name: string;
  hypothesis: string;
  status: string;
  variants: ExperimentVariant[];
  metrics: ExperimentMetric[];
}
interface ExperimentResultRow {
  id: string;
  experimentVariantId: string;
  experimentMetricId: string;
  value: string;
  measuredAt: string;
}
interface ExperimentDecisionRow {
  id: string;
  decision: string;
  rationale: string;
  decidedBy: string;
  decidedAt: string;
}
interface ExperimentDetail extends ExperimentSummary {
  decisions: ExperimentDecisionRow[];
  results: ExperimentResultRow[];
}

function eur(value: string | number) {
  return `EUR ${Number(value).toFixed(2)}`;
}

export default async function FinanceVenturePage({
  params,
}: {
  params: Promise<{ ventureProposalId: string }>;
}) {
  const { ventureProposalId } = await params;

  const [
    { data: assumption },
    { data: forecast },
    { data: forecastVsActual },
    { data: expenses },
    { data: revenueEntries },
    { data: experiments, status: experimentsStatus },
  ] = await Promise.all([
    serverApiFetch<FinancialAssumption | null>(
      `/finance/ventures/${ventureProposalId}/assumptions`,
    ),
    serverApiFetch<FinancialForecast | null>(`/finance/ventures/${ventureProposalId}/forecast`),
    serverApiFetch<ForecastVsActual | null>(
      `/finance/ventures/${ventureProposalId}/forecast-vs-actual`,
    ),
    serverApiFetch<Expense[]>(`/finance/ventures/${ventureProposalId}/expenses`),
    serverApiFetch<RevenueEntry[]>(`/finance/ventures/${ventureProposalId}/revenue`),
    serverApiFetch<ExperimentSummary[]>(`/finance/ventures/${ventureProposalId}/experiments`),
  ]);

  if (experimentsStatus === 404) {
    notFound();
  }

  const experimentDetails = new Map<string, ExperimentDetail>();
  await Promise.all(
    (experiments ?? []).map(async (exp) => {
      const { data } = await serverApiFetch<ExperimentDetail>(`/finance/experiments/${exp.id}`);
      if (data) experimentDetails.set(exp.id, data);
    }),
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/dashboard/finance" style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          ← Back to Finance Centre
        </Link>
        <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>Finance</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13 }}>
          Venture proposal <span style={{ fontFamily: 'monospace' }}>{ventureProposalId}</span>
        </p>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Assumptions</h2>
        {assumption ? (
          <p style={{ fontSize: 13 }}>
            Price {eur(assumption.productPriceEur)} &nbsp;·&nbsp; Marketplace fee{' '}
            {(Number(assumption.marketplaceFeeRate) * 100).toFixed(1)}% &nbsp;·&nbsp; Payment fee{' '}
            {(Number(assumption.paymentProcessingFeeRate) * 100).toFixed(1)}% &nbsp;·&nbsp; AI
            generation cost {eur(assumption.aiGenerationCostEur)} &nbsp;·&nbsp; Monthly overhead{' '}
            {eur(assumption.monthlyOverheadAllocationEur)} &nbsp;·&nbsp; Target margin{' '}
            {(Number(assumption.targetContributionMarginRate) * 100).toFixed(0)}%
          </p>
        ) : (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No assumptions set yet -- generating a forecast will seed development defaults
            automatically (see docs/FINANCIAL_MODEL.md).
          </p>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Forecast</h2>
        <GenerateForecastAction ventureProposalId={ventureProposalId} />
        {forecast ? (
          <>
            <p style={{ fontSize: 13, marginTop: 12 }}>
              Break-even:{' '}
              {forecast.breakEvenUnits === null
                ? 'not reachable at current assumptions'
                : `${forecast.breakEvenUnits} units (${eur(forecast.breakEvenRevenueEur ?? '0')})`}{' '}
              &nbsp;·&nbsp; Fixed costs {eur(forecast.fixedCostsEur)}
            </p>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                  <th style={{ padding: '8px 0' }}>Scenario</th>
                  <th>Units</th>
                  <th>Gross revenue</th>
                  <th>Net revenue</th>
                  <th>Gross profit</th>
                  <th>Net profit</th>
                </tr>
              </thead>
              <tbody>
                {forecast.scenarios.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                    <td style={{ padding: '8px 0' }}>{s.scenario}</td>
                    <td>{s.unitsSold}</td>
                    <td>{eur(s.grossRevenueEur)}</td>
                    <td>{eur(s.netRevenueEur)}</td>
                    <td>{eur(s.grossProfitEur)}</td>
                    <td>{eur(s.netProfitEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, marginTop: 12 }}>
            No forecast generated yet.
          </p>
        )}
        {forecastVsActual && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: 'var(--vos-bg-elevated)',
              fontSize: 13,
            }}
          >
            <strong>Forecast vs. actual (since latest forecast):</strong> forecast net revenue{' '}
            {eur(forecastVsActual.forecastNetRevenueEur)}, actual net revenue{' '}
            {eur(forecastVsActual.actualNetRevenueEur)} across {forecastVsActual.actualUnitsSold}{' '}
            unit(s) sold -- error {eur(forecastVsActual.forecastErrorEur)}
            {forecastVsActual.forecastErrorRate !== null &&
              ` (${(forecastVsActual.forecastErrorRate * 100).toFixed(1)}%)`}
          </div>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Expenses</h2>
        <RecordExpenseAction ventureProposalId={ventureProposalId} />
        {expenses && expenses.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Date</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>
                    {new Date(e.incurredAt).toLocaleDateString()}
                  </td>
                  <td>{e.category}</td>
                  <td>{eur(e.amountEur)}</td>
                  <td>{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Revenue</h2>
        <RecordRevenueAction ventureProposalId={ventureProposalId} />
        {revenueEntries && revenueEntries.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Date</th>
                <th>Units</th>
                <th>Gross</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {revenueEntries.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>
                    {new Date(r.occurredAt).toLocaleDateString()}
                  </td>
                  <td>{r.unitsSold}</td>
                  <td>{eur(r.grossRevenueEur)}</td>
                  <td>{eur(r.netRevenueEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Experiments (Gate 5/6)</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          Controlled tests with named variants and metrics defined up front. Scaling ad spend on the
          strength of results requires the same founder-approval gate as every other
          irreversible/costed action in this system (Gate 6, <code>SCALE_DECISION</code>).
        </p>
        <CreateExperimentAction ventureProposalId={ventureProposalId} />

        {(experiments ?? []).map((exp) => {
          const detail = experimentDetails.get(exp.id);
          return (
            <div
              key={exp.id}
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                background: 'var(--vos-bg-elevated)',
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                {exp.name} <span className="vos-badge">{exp.status}</span>
              </p>
              <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', margin: '4px 0' }}>
                {exp.hypothesis}
              </p>
              {detail && detail.results.length > 0 && (
                <table
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                      <th style={{ padding: '4px 0' }}>Variant</th>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Measured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.results.map((r) => {
                      const variant = exp.variants.find((v) => v.id === r.experimentVariantId);
                      const metric = exp.metrics.find((m) => m.id === r.experimentMetricId);
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                          <td style={{ padding: '4px 0' }}>{variant?.name ?? '—'}</td>
                          <td>{metric?.name ?? '—'}</td>
                          <td>{r.value}</td>
                          <td>{new Date(r.measuredAt).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {(() => {
                const latestDecision = detail?.decisions[0];
                if (!latestDecision) return null;
                return (
                  <p style={{ fontSize: 13, marginTop: 8 }}>
                    <strong>Decision:</strong> {latestDecision.decision} --{' '}
                    {latestDecision.rationale} (by {latestDecision.decidedBy} at{' '}
                    {new Date(latestDecision.decidedAt).toLocaleString()})
                  </p>
                );
              })()}
              <ExperimentPanelActions
                experimentId={exp.id}
                status={exp.status}
                variants={exp.variants}
                metrics={exp.metrics}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
