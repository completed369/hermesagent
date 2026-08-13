import { serverApiFetch } from '@/lib/server-api';
import {
  COMMAND_CENTRE_STATUS_COPY,
  ventureProposalCount,
  pendingApprovalCount,
  currentBudgetUtilisation,
  connectedIntegrationCount,
} from '@/lib/dashboard';

interface WorkspaceSummary {
  workspace: { name: string; slug: string; baseCurrency: string };
  memberCount: number;
  ventureCount?: number | null;
  integrations: Array<{ provider: string; mode: string; status: string; writeEnabled: boolean }>;
}

interface ApprovalRequest {
  id: string;
  state: string;
}

interface BudgetAllocation {
  spentEur: string | number | null;
}

interface Budget {
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalLimitEur: string | number | null;
  allocations?: BudgetAllocation[] | null;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function CommandCentrePage() {
  const [summaryRes, approvalsRes, budgetsRes] = await Promise.all([
    serverApiFetch<WorkspaceSummary>('/workspaces/current'),
    serverApiFetch<ApprovalRequest[]>('/approval-requests'),
    serverApiFetch<Budget[]>('/finance/budgets'),
  ]);

  const summary = summaryRes.data;
  const approvals = approvalsRes.data;
  const budgets = budgetsRes.data;

  const ventureValue = ventureProposalCount(summary?.ventureCount ?? null);
  const pendingValue = pendingApprovalCount(approvals);
  const budget = currentBudgetUtilisation(budgets);
  const connectedCount = connectedIntegrationCount(summary?.integrations ?? null);
  const totalIntegrations = summary?.integrations.length ?? null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>Command Centre</h1>
        <p style={{ color: 'var(--vos-text-muted)', margin: '4px 0 0' }}>
          {summary
            ? `${summary.workspace.name} · ${summary.workspace.baseCurrency} · ${summary.memberCount} member(s)`
            : 'Loading workspace...'}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Venture proposals
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>{ventureValue ?? '—'}</p>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Pending approvals
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>{pendingValue ?? '—'}</p>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Current budget utilisation
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {budget
              ? `${formatEur(budget.totalSpentEur)} / ${formatEur(budget.totalLimitEur)}`
              : '—'}
          </p>
        </div>
        <div className="vos-card">
          <p style={{ fontSize: 12, color: 'var(--vos-text-muted)', margin: 0 }}>
            Integrations connected
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>
            {connectedCount ?? '-'}
            {totalIntegrations !== null ? ` / ${totalIntegrations}` : ''}
          </p>
        </div>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Integration status</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--vos-text-muted)' }}>
              <th style={{ padding: '6px 0' }}>Provider</th>
              <th>Mode</th>
              <th>Write enabled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.integrations ?? []).map((i) => (
              <tr key={i.provider} style={{ borderTop: '1px solid var(--vos-border)' }}>
                <td style={{ padding: '8px 0' }}>{i.provider}</td>
                <td>{i.mode}</td>
                <td>{i.writeEnabled ? 'Yes' : 'No'}</td>
                <td>
                  <span
                    className={`vos-badge ${i.status === 'CONNECTED' ? 'vos-badge--ok' : 'vos-badge--mock'}`}
                  >
                    {i.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="vos-card">
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>What&apos;s available vs. gated</h2>
        <p style={{ fontSize: 13, color: 'var(--vos-text-muted)', margin: 0 }}>
          {COMMAND_CENTRE_STATUS_COPY}
        </p>
      </div>
    </div>
  );
}
