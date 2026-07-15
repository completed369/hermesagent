import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';

interface ProductListItem {
  id: string;
  status: string;
  title: string;
  ventureProposalId: string;
  createdAt: string;
  updatedAt: string;
  ventureProposal: {
    opportunity: {
      title: string;
    };
  } | null;
}

function statusBadgeClass(status: string) {
  if (['QA_PASSED', 'APPROVED', 'GENERATED'].includes(status)) return 'vos-badge vos-badge--ok';
  if (['QA_FAILED', 'REJECTED'].includes(status)) return 'vos-badge vos-badge--danger';
  return 'vos-badge vos-badge--mock';
}

export default async function ProductStudioPage() {
  const { data, status } = await serverApiFetch<ProductListItem[]>('/products');

  // A non-2xx (auth/permission/API failure) renders a safe unavailable state.
  // We never pretend there are no products when the request simply failed.
  const unavailable = status !== 200;
  const products = data ?? [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Product Studio</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Generated products and their listing workflows. Products are created from an approved
          venture proposal in the Board Room.
        </p>
      </div>

      <div className="vos-card">
        {unavailable ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            Product list is currently unavailable. Please try again later.
          </p>
        ) : products.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>
            No products yet. Promote and approve a venture in the Board Room, then start product
            generation to create one.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Product</th>
                <th>Source opportunity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{p.title}</td>
                  <td>{p.ventureProposal?.opportunity.title ?? '—'}</td>
                  <td>
                    <span className={statusBadgeClass(p.status)}>{p.status}</span>
                  </td>
                  <td>
                    <Link
                      href={`/dashboard/products/${p.id}`}
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
