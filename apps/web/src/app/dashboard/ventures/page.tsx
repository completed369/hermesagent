import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';

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
  const [{ data: ventures }, { data: billing }] = await Promise.all([
    serverApiFetch<VentureListItem[]>('/ventures'),
    serverApiFetch<BillingUsage>('/billing'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Ventures</h1>
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
            Every concurrent venture in this workspace -- promote an opportunity in the Opportunity
            Feed to start a new one.
          </p>
        </div>
        {billing && (
          <div className="vos-card" style={{ padding: '10px 16px', textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--vos-text-muted)' }}>
              {billing.subscription.plan.name} plan
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {billing.usage.ventures.used} / {billing.usage.ventures.limit} ventures used
            </div>
            <Link href="/dashboard/settings" style={{ fontSize: 12, color: 'var(--vos-accent)' }}>
              Manage plan
            </Link>
          </div>
        )}
      </div>

      <div className="vos-card">
        {!ventures || ventures.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No ventures yet. Promote an opportunity from the Opportunity Feed to create one.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Venture</th>
                <th>Proposal Status</th>
                <th>Opportunity Score</th>
                <th>Profit Confidence</th>
                <th>Product</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ventures.map((v) => (
                <tr key={v.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{v.opportunity.title}</td>
                  <td>
                    <span className={statusBadgeClass(v.status)}>{v.status}</span>
                  </td>
                  <td>
                    {v.opportunity.latestOpportunityScore ?? '—'}
                    {v.opportunity.isSpeculative && (
                      <span className="vos-badge vos-badge--mock" style={{ marginLeft: 6 }}>
                        Speculative
                      </span>
                    )}
                  </td>
                  <td>{v.opportunity.latestProfitConfidence ?? '—'}</td>
                  <td>
                    {v.product ? (
                      <span className="vos-badge vos-badge--mock">{v.product.status}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 12 }}>
                    <Link
                      href={`/dashboard/board-room/${v.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Board Room
                    </Link>
                    <Link
                      href={`/dashboard/finance/${v.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Finance
                    </Link>
                    {v.product && (
                      <Link
                        href={`/dashboard/products/${v.product.id}`}
                        style={{ color: 'var(--vos-accent)' }}
                      >
                        Product
                      </Link>
                    )}
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
