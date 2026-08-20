import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { DataSurface, EmptyState, PageHeader } from '@/components/workspace-ui';
import { resolveListResponse } from '@/lib/list-response';

interface VentureListItem {
  id: string;
  status: string;
  opportunityId: string;
  createdAt: string;
  opportunity: {
    title: string;
    status: string;
    latestOpportunityScore: string | null;
    latestProfitConfidence: string | null;
    isSpeculative: boolean;
  };
  product: { id: string; status: string } | null;
}

interface BillingUsage {
  usage: {
    ventures: { used: number; limit: number };
  };
  subscription: { plan: { name: string; key: string } };
}

function statusBadgeClass(status: string) {
  if (status === 'APPROVED') return 'vos-badge vos-badge--ok';
  if (status === 'REJECTED') return 'vos-badge vos-badge--danger';
  return 'vos-badge vos-badge--mock';
}

export default async function VenturesPage() {
  const [{ data: ventureData, status: ventureStatus }, { data: billing }] = await Promise.all([
    serverApiFetch<VentureListItem[]>('/ventures'),
    serverApiFetch<BillingUsage>('/billing'),
  ]);
  const ventures = resolveListResponse(ventureData, ventureStatus);

  return (
    <div className="vos-page-stack">
      <PageHeader
        eyebrow="Portfolio view"
        title="Ventures"
        description="Track every promoted venture and move between its governance, finance, and product workspaces."
        action={
          billing ? (
            <div className="vos-usage-chip">
              <span>{billing.subscription.plan.name} plan</span>
              <strong>
                {billing.usage.ventures.used} / {billing.usage.ventures.limit}
              </strong>
              <small>ventures used</small>
              <Link href="/dashboard/settings" className="vos-usage-link">
                Manage plan
              </Link>
            </div>
          ) : undefined
        }
      />
      <DataSurface
        title="Active portfolio"
        description={
          ventures.kind === 'unavailable'
            ? 'Venture count unavailable'
            : `${ventures.items.length} venture proposals`
        }
      >
        {ventures.kind === 'unavailable' ? (
          <EmptyState title="Ventures unavailable">
            The active portfolio could not be loaded. No empty-state assumptions have been made;
            please retry.
          </EmptyState>
        ) : ventures.kind === 'empty' ? (
          <EmptyState title="No ventures yet">
            Promote an opportunity from the Opportunity Feed to begin a governed venture.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Venture</th>
                <th>Proposal Status</th>
                <th>Opportunity Score</th>
                <th>Profit Confidence</th>
                <th>Product</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ventures.items.map((v) => (
                <tr key={v.id}>
                  <td data-label="Venture">
                    <strong>{v.opportunity.title}</strong>
                  </td>
                  <td data-label="Proposal status">
                    <span className={statusBadgeClass(v.status)}>{v.status}</span>
                  </td>
                  <td data-label="Opportunity score">
                    {v.opportunity.latestOpportunityScore ?? '—'}
                    {v.opportunity.isSpeculative && (
                      <span className="vos-badge vos-badge--mock" style={{ marginLeft: 6 }}>
                        Speculative
                      </span>
                    )}
                  </td>
                  <td data-label="Profit confidence">
                    {v.opportunity.latestProfitConfidence ?? '—'}
                  </td>
                  <td data-label="Product">
                    {v.product ? (
                      <span className="vos-badge vos-badge--mock">{v.product.status}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Open" className="vos-row-actions">
                    <Link href={`/dashboard/board-room/${v.id}`} className="vos-row-link">
                      Board
                    </Link>
                    <Link href={`/dashboard/finance/${v.id}`} className="vos-row-link">
                      Finance
                    </Link>
                    {v.product && (
                      <Link href={`/dashboard/products/${v.product.id}`} className="vos-row-link">
                        Product
                      </Link>
                    )}
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
