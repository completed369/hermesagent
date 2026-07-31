import { notFound } from 'next/navigation';
import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { ResearchConnectorActions } from '@/components/research-connector-actions';

interface DataAcquisitionRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  costEur: string;
  itemsRetrieved: number;
  promptInjectionFlagged: boolean;
  promptInjectionMatches: string[];
  blockedReason: string | null;
  errorMessage: string | null;
  evidenceArtifactId: string | null;
}

interface EvidenceArtifact {
  id: string;
  sourceName: string;
  retrievedAt: string;
  reliabilityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  personalDataClassification: string;
  originalExcerpt: string | null;
  contentHash: string;
}

interface DataSource {
  id: string;
  name: string;
  evidenceArtifacts: EvidenceArtifact[];
}

interface ContractDetail {
  id: string;
  name: string;
  purpose: string;
  sourceType: string;
  accessMethod: string;
  authenticationMethod: string;
  allowedOperations: string[];
  prohibitedOperations: string[];
  rateLimitPerMinute: number | null;
  rateLimitPerDay: number | null;
  freshnessRequirementHours: number;
  retryPolicy: string;
  failureHandling: string;
  retentionDays: number;
  personalDataClassification: string;
  termsOfUseNote: string | null;
  geographicLimitations: string | null;
  monitoringNote: string | null;
  disabled: boolean;
  disabledReason: string | null;
  costPerRunEurEstimate: string;
  runs: DataAcquisitionRun[];
  dataSources: DataSource[];
}

function runStatusBadgeClass(status: string) {
  if (status === 'SUCCEEDED') return 'vos-badge--ok';
  if (status.startsWith('BLOCKED') || status === 'FAILED') return 'vos-badge--danger';
  return 'vos-badge--mock';
}

export default async function ResearchConnectorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, status } = await serverApiFetch<ContractDetail>(`/research/contracts/${id}`);
  if (status === 404 || !data) {
    notFound();
  }
  const contract = data;
  const evidenceArtifacts = contract.dataSources.flatMap((ds) => ds.evidenceArtifacts);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/dashboard/research" style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          ← Back to Research Connectors
        </Link>
        <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>{contract.name}</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, maxWidth: 720 }}>
          {contract.purpose}
        </p>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Contract (master spec section 16)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            <Row label="Source type" value={contract.sourceType} />
            <Row label="Access method" value={contract.accessMethod} />
            <Row label="Authentication" value={contract.authenticationMethod} />
            <Row label="Allowed operations" value={contract.allowedOperations.join(', ') || '—'} />
            <Row
              label="Prohibited operations"
              value={contract.prohibitedOperations.join(', ') || '—'}
            />
            <Row
              label="Rate limits"
              value={`${contract.rateLimitPerMinute ?? 'none'}/min, ${contract.rateLimitPerDay ?? 'none'}/day`}
            />
            <Row label="Freshness requirement" value={`${contract.freshnessRequirementHours}h`} />
            <Row label="Retry policy" value={contract.retryPolicy} />
            <Row label="Failure handling" value={contract.failureHandling} />
            <Row label="Retention" value={`${contract.retentionDays} days`} />
            <Row label="Personal data classification" value={contract.personalDataClassification} />
            <Row label="Terms of use" value={contract.termsOfUseNote ?? '—'} />
            <Row label="Geographic limitations" value={contract.geographicLimitations ?? '—'} />
            <Row label="Monitoring" value={contract.monitoringNote ?? '—'} />
            <Row
              label="Disable switch"
              value={
                contract.disabled
                  ? `DISABLED — ${contract.disabledReason ?? 'no reason recorded'}`
                  : 'ENABLED'
              }
            />
            <Row label="Est. cost per run" value={`€${contract.costPerRunEurEstimate}`} />
          </tbody>
        </table>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Actions</h2>
        <ResearchConnectorActions contractId={contract.id} />
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Run history</h2>
        {contract.runs.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No runs yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Started</th>
                <th>Status</th>
                <th>Cost</th>
                <th>Items</th>
                <th>Prompt injection</th>
                <th>Blocked / error</th>
              </tr>
            </thead>
            <tbody>
              {contract.runs.map((run) => (
                <tr key={run.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{new Date(run.startedAt).toLocaleString()}</td>
                  <td>
                    <span className={`vos-badge ${runStatusBadgeClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>€{run.costEur}</td>
                  <td>{run.itemsRetrieved}</td>
                  <td>
                    {run.promptInjectionFlagged ? (
                      <span className="vos-badge vos-badge--danger">
                        FLAGGED: {run.promptInjectionMatches.join(', ')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{run.blockedReason ?? run.errorMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Evidence produced</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', marginTop: 0 }}>
          Freshness/reliability are computed for real from this contract&apos;s freshness
          requirement and source type (Phase 5 deliverable #3) -- never hand-typed. The excerpt
          below is always the sanitized version; any prompt-injection attempt in the raw payload has
          already been neutralized before it reaches this page.
        </p>
        {evidenceArtifacts.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No evidence produced yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Retrieved</th>
                <th>Reliability</th>
                <th>Freshness</th>
                <th>Relevance</th>
                <th>Personal data</th>
                <th>Sanitized excerpt</th>
                <th>Content hash</th>
              </tr>
            </thead>
            <tbody>
              {evidenceArtifacts.map((artifact) => (
                <tr key={artifact.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>
                    {new Date(artifact.retrievedAt).toLocaleString()}
                  </td>
                  <td>{artifact.reliabilityScore}</td>
                  <td>{artifact.freshnessScore}</td>
                  <td>{artifact.relevanceScore}</td>
                  <td>{artifact.personalDataClassification}</td>
                  <td style={{ maxWidth: 320 }}>{artifact.originalExcerpt ?? '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {artifact.contentHash.slice(0, 12)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderTop: '1px solid var(--vos-border)' }}>
      <td style={{ padding: '6px 12px 6px 0', color: 'var(--vos-text-muted)', width: 220 }}>
        {label}
      </td>
      <td style={{ padding: '6px 0' }}>{value}</td>
    </tr>
  );
}
