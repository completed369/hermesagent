import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';

interface OpportunityListItem {
  id: string;
  title: string;
  status: string;
  suggestedMarketplace: string | null;
  estimatedProfitEur: string | null;
  latestOpportunityScore: string | null;
  latestProfitConfidence: string | null;
  isSpeculative: boolean;
  timeToLaunchDays: number | null;
  evidenceClaims: { id: string }[];
}

function statusBadgeClass(status: string) {
  if (status === 'PROMOTED') return 'vos-badge vos-badge--ok';
  if (status === 'REJECTED' || status === 'ARCHIVED') return 'vos-badge vos-badge--danger';
  return 'vos-badge vos-badge--mock';
}

export default async function OpportunitiesPage() {
  const { data } = await serverApiFetch<OpportunityListItem[]>('/opportunities');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Opportunity Feed</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Every candidate venture, with its Opportunity Score, Profit Confidence Score, and evidence
          trail.
        </p>
      </div>
      <div className="vos-card">
        {!data || data.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No opportunities yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Title</th>
                <th>Status</th>
                <th>Opportunity Score</th>
                <th>Profit Confidence</th>
                <th>Est. Profit</th>
                <th>Time to Launch</th>
                <th>Evidence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{o.title}</td>
                  <td>
                    <span className={statusBadgeClass(o.status)}>{o.status}</span>
                  </td>
                  <td>
                    {o.latestOpportunityScore ?? '—'}
                    {o.isSpeculative && (
                      <span className="vos-badge vos-badge--mock" style={{ marginLeft: 6 }}>
                        Speculative
                      </span>
                    )}
                  </td>
                  <td>{o.latestProfitConfidence ?? '—'}</td>
                  <td>{o.estimatedProfitEur ? `€${o.estimatedProfitEur}` : '—'}</td>
                  <td>{o.timeToLaunchDays != null ? `${o.timeToLaunchDays}d` : '—'}</td>
                  <td>{o.evidenceClaims.length} sources</td>
                  <td>
                    <Link
                      href={`/dashboard/opportunities/${o.id}`}
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
