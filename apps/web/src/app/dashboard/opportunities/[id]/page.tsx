import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { OpportunityActions } from '@/components/opportunity-actions';

interface EvidenceArtifact {
  sourceName: string;
  retrievedAt: string;
  reliabilityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  termsOfUseNote: string | null;
  contentHash: string;
}
interface EvidenceClaim {
  id: string;
  claimType: string;
  statement: string;
  evidenceArtifact: EvidenceArtifact;
}
interface OpportunityScore {
  id: string;
  scoreType: string;
  formulaVersion: string;
  score: string;
  calculatedAt: string;
}
interface TargetCustomer {
  id: string;
  persona: string;
  painPoints: string[];
  buyingTriggers: string[];
}
interface ChannelRecommendation {
  id: string;
  channel: string;
  rationale: string;
}
interface OpportunityDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  suggestedProductType: string | null;
  suggestedMarketplace: string | null;
  estimatedCostEur: string | null;
  estimatedRevenueEur: string | null;
  estimatedProfitEur: string | null;
  timeToLaunchDays: number | null;
  risks: string[];
  latestOpportunityScore: string | null;
  latestProfitConfidence: string | null;
  isSpeculative: boolean;
  rejectionReason: string | null;
  targetCustomers: TargetCustomer[];
  channels: ChannelRecommendation[];
  evidenceClaims: EvidenceClaim[];
  scores: OpportunityScore[];
  proposal: { id: string; status: string } | null;
}

const CLAIM_TYPE_LABEL: Record<string, string> = {
  VERIFIED_FACT: 'Verified Fact',
  EXTERNAL_ESTIMATE: 'External Estimate',
  FOUNDER_PROVIDED_FACT: 'Founder-Provided Fact',
  SYSTEM_CALCULATED_VALUE: 'System-Calculated Value',
  AGENT_ASSUMPTION: 'Agent Assumption (unverified)',
  UNKNOWN: 'Unknown',
};

function claimBadgeClass(claimType: string) {
  if (claimType === 'VERIFIED_FACT' || claimType === 'SYSTEM_CALCULATED_VALUE')
    return 'vos-badge--ok';
  if (claimType === 'AGENT_ASSUMPTION' || claimType === 'UNKNOWN') return 'vos-badge--danger';
  return 'vos-badge--mock';
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, status } = await serverApiFetch<OpportunityDetail>(`/opportunities/${id}`);
  if (status === 404 || !data) {
    notFound();
  }
  const opportunity = data;
  const evidenceQuality = opportunity.scores.find(
    (score) => score.scoreType === 'EVIDENCE_QUALITY',
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link
          href="/dashboard/opportunities"
          style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}
        >
          ← Back to Opportunity Feed
        </Link>
        <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>{opportunity.title}</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, maxWidth: 720 }}>
          {opportunity.description}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
        }}
      >
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Opportunity Score
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {opportunity.latestOpportunityScore ?? '—'}
          </p>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Evidence Quality
          </p>
          <p
            data-testid="evidence-quality-score"
            style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}
          >
            {evidenceQuality?.score ?? '—'}
          </p>
          {evidenceQuality ? (
            <p style={{ fontSize: 11, color: 'var(--vos-text-muted)', margin: '4px 0 0' }}>
              {evidenceQuality.formulaVersion}
            </p>
          ) : null}
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Profit Confidence
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {opportunity.latestProfitConfidence ?? '—'}
          </p>
          {opportunity.isSpeculative && (
            <span
              className="vos-badge vos-badge--mock"
              style={{ marginTop: 8, display: 'inline-flex' }}
            >
              Speculative
            </span>
          )}
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Estimated Profit
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {opportunity.estimatedProfitEur ? `€${opportunity.estimatedProfitEur}` : '—'}
          </p>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>Time to Launch</p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {opportunity.timeToLaunchDays != null ? `${opportunity.timeToLaunchDays}d` : '—'}
          </p>
        </div>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Suggested approach</h2>
        <p style={{ fontSize: 14 }}>
          <strong>Product type:</strong> {opportunity.suggestedProductType ?? '—'} &nbsp;·&nbsp;
          <strong>Marketplace:</strong> {opportunity.suggestedMarketplace ?? '—'} &nbsp;·&nbsp;
          <strong>Est. cost:</strong>{' '}
          {opportunity.estimatedCostEur ? `€${opportunity.estimatedCostEur}` : '—'} &nbsp;·&nbsp;
          <strong>Est. revenue:</strong>{' '}
          {opportunity.estimatedRevenueEur ? `€${opportunity.estimatedRevenueEur}` : '—'}
        </p>
        {opportunity.targetCustomers.map((tc) => (
          <div key={tc.id} style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Target customer</p>
            <p style={{ fontSize: 14, margin: 0 }}>{tc.persona}</p>
            <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', marginTop: 4 }}>
              Pain points: {tc.painPoints.join(', ') || '—'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
              Buying triggers: {tc.buyingTriggers.join(', ') || '—'}
            </p>
          </div>
        ))}
        {opportunity.channels.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Recommended channels</p>
            <ul style={{ fontSize: 14, margin: 0, paddingLeft: 18 }}>
              {opportunity.channels.map((c) => (
                <li key={c.id}>
                  <strong>{c.channel}</strong> — {c.rationale}
                </li>
              ))}
            </ul>
          </div>
        )}
        {opportunity.risks.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Risks</p>
            <ul
              style={{ fontSize: 14, margin: 0, paddingLeft: 18, color: 'var(--vos-text-muted)' }}
            >
              {opportunity.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {opportunity.rejectionReason && (
          <p className="vos-error" style={{ marginTop: 12 }}>
            Rejected: {opportunity.rejectionReason}
          </p>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Evidence trail</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', marginTop: 0 }}>
          Every claim below carries its evidence classification (master spec section 15) - an
          assumption is never presented as a verified fact.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
              <th style={{ padding: '8px 0' }}>Claim</th>
              <th>Classification</th>
              <th>Source</th>
              <th>Retrieved</th>
              <th>Reliability</th>
              <th>Freshness</th>
              <th>Relevance</th>
              <th>Content hash</th>
            </tr>
          </thead>
          <tbody>
            {opportunity.evidenceClaims.map((claim) => (
              <tr key={claim.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                <td style={{ padding: '10px 0', maxWidth: 280 }}>{claim.statement}</td>
                <td>
                  <span className={`vos-badge ${claimBadgeClass(claim.claimType)}`}>
                    {CLAIM_TYPE_LABEL[claim.claimType] ?? claim.claimType}
                  </span>
                </td>
                <td>{claim.evidenceArtifact.sourceName}</td>
                <td>{new Date(claim.evidenceArtifact.retrievedAt).toLocaleDateString()}</td>
                <td>{claim.evidenceArtifact.reliabilityScore}</td>
                <td>{claim.evidenceArtifact.freshnessScore}</td>
                <td>{claim.evidenceArtifact.relevanceScore}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {claim.evidenceArtifact.contentHash.slice(0, 12)}...
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {opportunity.evidenceClaims.some((c) => c.evidenceArtifact.termsOfUseNote) && (
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', marginTop: 12 }}>
            Terms-of-use notes:{' '}
            {opportunity.evidenceClaims
              .filter((c) => c.evidenceArtifact.termsOfUseNote)
              .map((c) => c.evidenceArtifact.termsOfUseNote)
              .join(' | ')}
          </p>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Actions</h2>
        <OpportunityActions id={opportunity.id} status={opportunity.status} />
        {opportunity.proposal && (
          <p style={{ fontSize: 14, marginTop: 12 }}>
            <a
              href={`/dashboard/board-room/${opportunity.proposal.id}`}
              style={{ color: 'var(--vos-accent)' }}
            >
              View Board Room for this venture proposal →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
