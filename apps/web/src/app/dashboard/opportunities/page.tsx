import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { DataSurface, EmptyState, PageHeader } from '@/components/workspace-ui';

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
    <div className="vos-page-stack">
      <PageHeader
        eyebrow="Discovery pipeline"
        title="Opportunities"
        description="Compare candidate ventures using scored assumptions, confidence, and their supporting evidence trail."
        action={
          <Link className="vos-btn" href="/dashboard/opportunities/new">
            New opportunity <span aria-hidden="true">＋</span>
          </Link>
        }
      />
      <DataSurface
        title="Opportunity feed"
        description={`${data?.length ?? 0} candidates in the current workspace`}
      >
        {!data || data.length === 0 ? (
          <EmptyState title="No opportunities yet">
            Create a candidate to begin evidence-backed evaluation.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Title</th>
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
                <tr key={o.id}>
                  <td data-label="Title">
                    <strong>{o.title}</strong>
                  </td>
                  <td data-label="Status">
                    <span className={statusBadgeClass(o.status)}>{o.status}</span>
                  </td>
                  <td data-label="Opportunity score">
                    {o.latestOpportunityScore ?? '—'}
                    {o.isSpeculative && (
                      <span className="vos-badge vos-badge--mock" style={{ marginLeft: 6 }}>
                        Speculative
                      </span>
                    )}
                  </td>
                  <td data-label="Profit confidence">{o.latestProfitConfidence ?? '—'}</td>
                  <td data-label="Estimated profit">
                    {o.estimatedProfitEur ? `€${o.estimatedProfitEur}` : '—'}
                  </td>
                  <td data-label="Time to launch">
                    {o.timeToLaunchDays != null ? `${o.timeToLaunchDays}d` : '—'}
                  </td>
                  <td data-label="Evidence">{o.evidenceClaims.length} sources</td>
                  <td data-label="Action">
                    <Link href={`/dashboard/opportunities/${o.id}`} className="vos-row-link">
                      Open <span aria-hidden="true">↗</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataSurface>
    </div>
  );
}
