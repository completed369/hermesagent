'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api';

interface RunResult {
  runId: string;
  status: string;
  evidenceArtifactId: string | null;
  promptInjectionFlagged: boolean;
  blockedReason: string | null;
}

/**
 * Triggers POST /research/contracts/:id/run. Unlike Product Studio's
 * polling action, an acquisition run is synchronous (mock provider, no
 * founder-approval wait), so the response already contains the final
 * status -- no polling loop needed.
 */
export function ResearchConnectorActions({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);

  async function triggerRun() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<RunResult>(`/research/contracts/${contractId}/run`, {
        method: 'POST',
      });
      setLastResult(result);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to trigger acquisition run');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error && <p className="vos-error">{error}</p>}
      <button type="button" className="vos-btn" disabled={loading} onClick={triggerRun}>
        {loading ? 'Running acquisition...' : 'Run acquisition now'}
      </button>
      {lastResult && (
        <p style={{ fontSize: 13, margin: 0 }}>
          Last run: <strong>{lastResult.status}</strong>
          {lastResult.blockedReason ? ` — ${lastResult.blockedReason}` : ''}
          {lastResult.promptInjectionFlagged
            ? ' — prompt-injection content flagged and sanitized before storage'
            : ''}
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
        Mock provider only (no live network calls). Blocked automatically if the contract is
        disabled, rate-limited, or would exceed the workspace&apos;s research cost caps -- always
        recorded as a real run row, never silently skipped.
      </p>
    </div>
  );
}
