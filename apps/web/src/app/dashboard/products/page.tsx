import Link from 'next/link';
import { serverApiFetch } from '@/lib/server-api';
import { DataSurface, EmptyState, PageHeader } from '@/components/workspace-ui';

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
    <div className="vos-page-stack">
      <PageHeader
        eyebrow="Creation pipeline"
        title="Products"
        description="Review generated products and the governed listing workflows connected to approved ventures."
      />
      <DataSurface
        title="Product studio"
        description={`${products.length} products in this workspace`}
      >
        {unavailable ? (
          <EmptyState title="Products unavailable">
            The product list could not be loaded. No empty-state assumptions have been made; please
            retry.
          </EmptyState>
        ) : products.length === 0 ? (
          <EmptyState title="No products yet">
            Approve a venture in the Board Room, then begin generation to create a product.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Source opportunity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td data-label="Product">
                    <strong>{p.title}</strong>
                  </td>
                  <td data-label="Source opportunity">
                    {p.ventureProposal?.opportunity.title ?? '—'}
                  </td>
                  <td data-label="Status">
                    <span className={statusBadgeClass(p.status)}>{p.status}</span>
                  </td>
                  <td data-label="Action">
                    <Link href={`/dashboard/products/${p.id}`} className="vos-row-link">
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
