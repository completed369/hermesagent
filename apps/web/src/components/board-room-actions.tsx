'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface BoardReviewSummary {
  id: string;
  status: string;
}

/**
 * Triggers the Temporal `boardApprovalWorkflow` (apps/worker) via
 * POST /venture-proposals/:id/board-reviews. The workflow runs the 8 mock
 * board agents and creates the founder ApprovalRequest almost immediately,
 * then blocks waiting for a founder decision -- this component only needs
 * to poll until the new BoardReview row shows COMPLETED (or FAILED), not
 * wait for the whole workflow to finish.
 */
export function BoardRoomActions({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runReview() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/venture-proposals/${proposalId}/board-reviews`, { method: 'POST' });

      const knownIds = new Set(
        (
          await apiFetch<BoardReviewSummary[]>(`/venture-proposals/${proposalId}/board-reviews`)
        ).map((r) => r.id),
      );

      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const reviews = await apiFetch<BoardReviewSummary[]>(
          `/venture-proposals/${proposalId}/board-reviews`,
        );
        const newReview = reviews.find((r) => !knownIds.has(r.id));
        if (newReview && (newReview.status === 'COMPLETED' || newReview.status === 'FAILED')) {
          break;
        }
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start board review');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && <p className="vos-error">{error}</p>}
      <button type="button" className="vos-btn" disabled={loading} onClick={runReview}>
        {loading ? 'Running board review...' : 'Run Board Review'}
      </button>
    </div>
  );
}
