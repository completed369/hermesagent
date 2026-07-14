import { serverApiFetch } from '@/lib/server-api';

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
  const { data } = await serverApiFetch<ApprovalRequestListItem[]>('/approval-requests');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Approval Centre</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 13, marginTop: 4 }}>
          Every approval request created by a board review. The founder is the only authority that
          can approve, reject, request revision, or revoke -- decisions are always server-enforced
          and hash-bound to the exact venture proposal version reviewed.
        </p>
      </div>
      <div className="vos-card">
        {!data || data.length === 0 ? (
          <p style={{ color: 'var(--vos-text-muted)', fontSize: 14 }}>No approval requests yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Requested action</th>
                <th>State</th>
                <th>Est. cost</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((req) => (
                <tr key={req.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '10px 0' }}>{req.requestedAction}</td>
                  <td>
                    <span className={`vos-badge ${stateBadgeClass(req.state)}`}>{req.state}</span>
                  </td>
                  <td>€{req.estimatedCostEur}</td>
                  <td>{new Date(req.expiresAt).toLocaleDateString()}</td>
                  <td>
                    <a
                      href={`/dashboard/approvals/${req.id}`}
                      style={{ color: 'var(--vos-accent)' }}
                    >
                      Open
                    </a>
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
