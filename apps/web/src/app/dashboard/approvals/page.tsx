import { serverApiFetch } from '@/lib/server-api';
import Link from 'next/link';
import { DataSurface, EmptyState, PageHeader } from '@/components/workspace-ui';
import { resolveListResponse } from '@/lib/list-response';

interface ApprovalRequestListItem {
  id: string;
  requestedAction: string;
  state: string;
  estimatedCostEur: string;
  maxAuthorizedCostEur: string;
  expiresAt: string;
  createdAt: string;
}

function stateBadgeClass(state: string) {
  if (state === 'APPROVED' || state === 'APPROVED_WITH_CONDITIONS' || state === 'EXECUTED') {
    return 'vos-badge--ok';
  }
  if (['REJECTED', 'EXPIRED', 'REVOKED', 'EXECUTION_FAILED'].includes(state)) {
    return 'vos-badge--danger';
  }
  return 'vos-badge--mock';
}

export default async function ApprovalsPage() {
  const { data, status } = await serverApiFetch<ApprovalRequestListItem[]>('/approval-requests');
  const requests = resolveListResponse(data, status);

  return (
    <div className="vos-page-stack">
      <PageHeader
        eyebrow="Human authority"
        title="Approvals"
        description="Review consequential actions before execution. Decisions remain server-enforced and bound to the exact version reviewed."
      />
      <div className="vos-governance-banner">
        <span aria-hidden="true">◆</span>
        <p>
          <strong>Founder-controlled gate</strong> Nothing listed here executes simply because it
          was proposed.
        </p>
      </div>
      <DataSurface
        title="Decision queue"
        description={
          requests.kind === 'unavailable'
            ? 'Request count unavailable'
            : `${requests.items.length} requests recorded`
        }
      >
        {requests.kind === 'unavailable' ? (
          <EmptyState title="Approvals unavailable">
            The decision queue could not be loaded. No empty-state assumptions have been made;
            please retry.
          </EmptyState>
        ) : requests.kind === 'empty' ? (
          <EmptyState title="Decision queue clear">
            No approval requests are waiting in this workspace.
          </EmptyState>
        ) : (
          <table className="vos-data-table">
            <thead>
              <tr>
                <th>Requested action</th>
                <th>State</th>
                <th>Est. cost</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.items.map((req) => (
                <tr key={req.id}>
                  <td data-label="Requested action">
                    <strong>{req.requestedAction}</strong>
                  </td>
                  <td data-label="State">
                    <span className={`vos-badge ${stateBadgeClass(req.state)}`}>{req.state}</span>
                  </td>
                  <td data-label="Estimated cost">€{req.estimatedCostEur}</td>
                  <td data-label="Expires">{new Date(req.expiresAt).toLocaleDateString()}</td>
                  <td data-label="Action">
                    <Link href={`/dashboard/approvals/${req.id}`} className="vos-row-link">
                      Review <span aria-hidden="true">↗</span>
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
