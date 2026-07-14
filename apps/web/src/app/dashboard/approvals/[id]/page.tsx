import { notFound } from 'next/navigation';
import { serverApiFetch } from '@/lib/server-api';
import { ApprovalActions } from '@/components/approval-actions';

interface ApprovalDecisionRecord {
  id: string;
  founderIdentity: string;
  decidedAt: string;
  decision: string;
  conditions: string[];
  comment: string | null;
}
interface ApprovalRequestDetail {
  id: string;
  requestedAction: string;
  explanation: string;
  affectedResources: string[];
  packageHash: string;
  estimatedCostEur: string;
  maxAuthorizedCostEur: string;
  reversible: boolean;
  risks: string[];
  state: string;
  expiresAt: string;
  createdAt: string;
  decisions: ApprovalDecisionRecord[];
}

export default async function ApprovalDetailPage({ params }: { params: { id: string } }) {
  const { data, status } = await serverApiFetch<ApprovalRequestDetail>(
    `/approval-requests/${params.id}`,
  );
  if (status === 404 || !data) {
    notFound();
  }
  const request = data;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <a href="/dashboard/approvals" style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          ← Back to Approval Centre
        </a>
        <h1 style={{ margin: '8px 0 4px', fontSize: 24 }}>{request.requestedAction}</h1>
        <p style={{ color: 'var(--vos-text-muted)', fontSize: 14, maxWidth: 720 }}>
          {request.explanation}
        </p>
      </div>

      <div className="vos-card">
        <p style={{ fontSize: 14 }}>
          <strong>State:</strong> {request.state} &nbsp;·&nbsp;
          <strong>Est. cost:</strong> €{request.estimatedCostEur} &nbsp;·&nbsp;
          <strong>Max authorized:</strong> €{request.maxAuthorizedCostEur} &nbsp;·&nbsp;
          <strong>Reversible:</strong> {request.reversible ? 'Yes' : 'No'} &nbsp;·&nbsp;
          <strong>Expires:</strong> {new Date(request.expiresAt).toLocaleString()}
        </p>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
          <strong>Affected resources:</strong> {request.affectedResources.join(', ') || '—'}
        </p>
        {request.risks.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--vos-text-muted)' }}>
            <strong>Risks:</strong> {request.risks.join(', ')}
          </p>
        )}
        <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--vos-text-muted)' }}>
          Package hash: {request.packageHash}
        </p>
      </div>

      {request.decisions.length > 0 && (
        <div className="vos-card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Decision history</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
                <th style={{ padding: '8px 0' }}>Decision</th>
                <th>Founder</th>
                <th>Decided at</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {request.decisions.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--vos-border)' }}>
                  <td style={{ padding: '8px 0' }}>{d.decision}</td>
                  <td>{d.founderIdentity}</td>
                  <td>{new Date(d.decidedAt).toLocaleString()}</td>
                  <td>{d.comment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="vos-card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Decide</h2>
        <ApprovalActions id={request.id} state={request.state} />
      </div>
    </div>
  );
}
