'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface ProductSummary {
  id: string;
  status: string;
}

/**
 * Triggers the Temporal `productListingWorkflow` (apps/worker) via
 * POST /venture-proposals/:id/products. That workflow runs, in order: mock
 * product generation, QA checks, and -- only if QA passes -- mock listing
 * generation, SEO evaluation, and creation of the second (PRODUCT_LISTING)
 * founder ApprovalRequest, then blocks waiting for the founder's decision.
 * This component only needs to poll until the new Product row appears
 * (created early in the workflow, well before the founder-decision wait),
 * not wait for the whole workflow to finish -- same pattern as
 * BoardRoomActions.
 */
export function ProductStudioActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGeneration() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/venture-proposals/${proposalId}/products`, { method: 'POST' });

      const knownIds = new Set(
        (await apiFetch<ProductSummary[]>(`/venture-proposals/${proposalId}/products`)).map(
          (p) => p.id,
        ),
      );

      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const products = await apiFetch<ProductSummary[]>(
          `/venture-proposals/${proposalId}/products`,
        );
        const newProduct = products.find((p) => !knownIds.has(p.id));
        if (
          newProduct &&
          ['GENERATED', 'QA_PASSED', 'QA_FAILED', 'APPROVED', 'REJECTED'].includes(
            newProduct.status,
          )
        ) {
          break;
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start product generation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && <p className="vos-error">{error}</p>}
      <button type="button" className="vos-btn" disabled={loading} onClick={startGeneration}>
        {loading ? 'Generating product...' : 'Start Product Generation'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
        Blocked unless this venture proposal already has a founder-approved ApprovalRequest (Phase 3
        gate). Runs mock product generation, QA checks, and -- if QA passes -- mock listing
        generation, SEO evaluation, and a second founder approval request. Never publishes anything
        (Phase 6 scope).
      </p>
    </div>
  );
}
