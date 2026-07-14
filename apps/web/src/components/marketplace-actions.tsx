'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface PublicationAttemptSummary {
  id: string;
  status: string;
}
interface MarketplaceStatus {
  publicationAttempts: PublicationAttemptSummary[];
}

/**
 * Triggers the Temporal `marketplacePublicationWorkflow` (apps/worker) via
 * POST /marketplace/listings/:id/start. That workflow runs, in order:
 * mock draft-listing preparation, and -- only if that reaches
 * READY_FOR_PUBLISH -- creation of the second, distinct PUBLICATION founder
 * ApprovalRequest, then blocks waiting for the founder's decision before
 * ever calling the mock publish. This component only polls until the first
 * PublicationAttempt row appears (created early, well before the
 * founder-decision wait), not until the whole workflow finishes -- same
 * pattern as ProductStudioActions/BoardRoomActions.
 */
export function MarketplaceActions({ listingVersionId }: { listingVersionId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPublication() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/marketplace/listings/${listingVersionId}/start`, { method: 'POST' });

      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const status = await apiFetch<MarketplaceStatus>(
          `/marketplace/listings/${listingVersionId}`,
        );
        if (status.publicationAttempts.length > 0) break;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start publication workflow');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && <p className="vos-error">{error}</p>}
      <button type="button" className="vos-btn" disabled={loading} onClick={startPublication}>
        {loading ? 'Starting publication...' : 'Start publication (mock adapter)'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
        Runs the Temporal marketplacePublicationWorkflow: prepares a mock draft listing on the
        marketplace, then raises a second, distinct PUBLICATION founder approval (separate from the
        earlier product/listing approval). No real Etsy account is connected -- every step here is
        simulated by the mock adapter. Decide the PUBLICATION approval in the Approval Centre to let
        the workflow continue to (mock) publish.
      </p>
    </div>
  );
}
