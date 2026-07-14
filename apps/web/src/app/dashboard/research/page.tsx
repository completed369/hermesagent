import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  costEur: string;
  promptInjectionFlagged: boolean;
}

interface ContractListItem {
  id: string;
  name: string;
  sourceType: string;
  disabled: boolean;
  rateLimitPerMinute: number | null;
  rateLimitPerDay: number | null;
  personalDataClassification: string;
  runs: RunSummary[];
}

function sourceTypeBadgeClass(sourceType: string) {
  if (sourceType === 'OFFICIAL_API' || sourceType === 'FOUNDER_PROVIDED') return 'vos-badge--ok';
  if (sourceType === 'PERMITTED_BROWSER_RESEARCH') return 'vos-badge--mock';
  return 'vos-badge--mock';
}

function runStatusBadgeClass(status: string) {
  if (status === 'SUCCEEDED') return 'vos-badge--ok';
  if (status.startsWith('BLOCKED') || status === 'FAILED') return 'vos-badge--danger';
  return 'vos-badge--mock';
}

export default async function ResearchConnectorsPage() {
  const { data } = await serverApiFetch<ContractListItem[]>('/research/contracts');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Research Connectors</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Every data acquisition contract (master spec section 16), its allowed/prohibited
          operations, and its run history. Mock provider only -- no live network calls; fails closed
          on disabled/rate-limited/cost-capped contracts.
        </p>
      </div>
      <div className="vos-card">
        {!data || data.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No data acquisition contracts yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Contract</th>
                <th>Source type</th>
                <th>Rate limit</th>
                <th>Personal data</th>
                <th>Status</th>
                <th>Last run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{c.name}</td>
                  <td>
                    <span className={`vos-badge ${sourceTypeBadgeClass(c.sourceType)}`}>
                      {c.sourceType}
                    </span>
                  </td>
                  <td>
                    {c.rateLimitPerMinute != null ? `${c.rateLimitPerMinute}/min` : 'none'}
                    {c.rateLimitPerDay != null ? `, ${c.rateLimitPerDay}/day` : ''}
                  </td>
                  <td>{c.personalDataClassification}</td>
                  <td>
                    <span
                      className={`vos-badge ${c.disabled ? 'vos-badge--danger' : 'vos-badge--ok'}`}
                    >
                      {c.disabled ? 'DISABLED' : 'ENABLED'}
                    </span>
                  </td>
                  <td>
                    {c.runs[0] ? (
                      <span className={`vos-badge ${runStatusBadgeClass(c.runs[0].status)}`}>
                        {c.runs[0].status}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/dashboard/research/${c.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Open
                    </Link>
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
